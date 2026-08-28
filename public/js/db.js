const DB_NAME = 'BorwellDB';
const DB_VERSION = 1;

let localDB = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { localDB = request.result; resolve(localDB); };
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('workers')) db.createObjectStore('workers', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('machines')) db.createObjectStore('machines', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('attendance')) {
        const store = db.createObjectStore('attendance', { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('worker_id', 'worker_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('expenses')) {
        const store = db.createObjectStore('expenses', { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('jobs')) {
        const store = db.createObjectStore('jobs', { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('syncQueue')) {
        const store = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
        store.createIndex('synced', 'synced', { unique: false });
      }
    };
  });
}

function localGet(storeName) {
  return new Promise((resolve, reject) => {
    const tx = localDB.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function localPut(storeName, data) {
  return new Promise((resolve, reject) => {
    const tx = localDB.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(data);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function localDelete(storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = localDB.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function localClear(storeName) {
  return new Promise((resolve, reject) => {
    const tx = localDB.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function addToSyncQueue(table, data, action) {
  await localPut('syncQueue', { table, data, action, synced: 0, timestamp: Date.now() });
}

async function getPendingSync() {
  const all = await localGet('syncQueue');
  return all.filter(item => item.synced === 0);
}

async function markSynced(ids) {
  for (const id of ids) {
    const tx = localDB.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    const get = store.get(id);
    get.onsuccess = () => {
      const item = get.result;
      if (item) { item.synced = 1; store.put(item); }
    };
  }
}

async function saveToServerAndLocal(endpoint, data, storeName) {
  const isOnline = navigator.onLine;
  if (isOnline) {
    try {
      const result = await apiCall(endpoint, { method: 'POST', body: JSON.stringify(data) });
      if (result.id) data.id = result.id;
      await localPut(storeName, data);
      return result;
    } catch (err) {
      if (err.message === 'OFFLINE') {
        await addToSyncQueue(storeName, data, 'upsert');
        await localPut(storeName, data);
        return { offline: true, message: 'Saved locally, will sync when online' };
      }
      throw err;
    }
  } else {
    await addToSyncQueue(storeName, data, 'upsert');
    await localPut(storeName, data);
    return { offline: true, message: 'Saved locally, will sync when online' };
  }
}

async function syncLocalToServer() {
  const pending = await getPendingSync();
  if (pending.length === 0) return;

  const changes = pending.map(p => ({ table: p.table, data: p.data, action: p.action }));
  try {
    await apiCall('/api/sync/push', { method: 'POST', body: JSON.stringify({ changes }) });
    await markSynced(pending.map(p => p.id));
    showToast(`Synced ${pending.length} changes`);
  } catch (err) {
    console.log('Sync failed, will retry:', err.message);
  }
}

async function fetchAndCache(url, storeName) {
  try {
    const data = await apiCall(url);
    await localClear(storeName);
    if (Array.isArray(data)) {
      for (const item of data) await localPut(storeName, item);
    }
    return data;
  } catch (err) {
    if (err.message === 'OFFLINE' || !navigator.onLine) {
      const local = await localGet(storeName);
      if (local.length > 0) return local;
      throw new Error('No cached data available');
    }
    throw err;
  }
}
