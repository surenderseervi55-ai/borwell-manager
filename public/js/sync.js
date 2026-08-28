let syncInterval = null;

function startAutoSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(async () => {
    if (navigator.onLine) {
      await syncLocalToServer();
    }
  }, 300000); // every 5 minutes
}

function stopAutoSync() {
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
}

window.addEventListener('online', async () => {
  showToast('Internet connected! Syncing...');
  document.getElementById('offline-badge').style.display = 'none';
  await syncLocalToServer();
});

window.addEventListener('offline', () => {
  showToast('Offline mode - changes saved locally');
  document.getElementById('offline-badge').style.display = 'inline';
});

function updateOnlineStatus() {
  const badge = document.getElementById('offline-badge');
  if (badge) badge.style.display = navigator.onLine ? 'none' : 'inline';
}
