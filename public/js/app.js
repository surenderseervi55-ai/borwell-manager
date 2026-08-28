let socket = null;
let activeSection = 'admin-dashboard';

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function toggleSidebar() {
  document.querySelectorAll('.sidebar').forEach(s => s.classList.toggle('open'));
}

function showSection(id, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.sidebar').forEach(s => s.classList.remove('open'));
  activeSection = id;
  loadSection(id);
}

function showModal(title, content, footer) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal"><h2>${title}</h2>${content}<div class="modal-actions">${footer || ''}<button class="btn btn-sm" onclick="this.closest('.modal-overlay').remove()">Cancel</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function formatDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatMoney(n) {
  return '₹' + (Number(n) || 0).toLocaleString('en-IN');
}

function today() { return new Date().toISOString().split('T')[0]; }

async function apiCall(url, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  try {
    const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
    if (res.status === 401) { logout(); throw new Error('Session expired'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (err) {
    throw err;
  }
}

function initSocket() {
  socket = io(window.location.origin);
  socket.on('connect', () => showToast('Connected - Real-time sync active'));
  socket.on('disconnect', () => showToast('Disconnected - Will reconnect...'));

  const events = ['attendance:added', 'attendance:updated', 'attendance:deleted', 'attendance:bulk',
                  'expense:added', 'expense:updated', 'expense:deleted',
                  'job:added', 'job:updated', 'job:deleted',
                  'worker:added', 'worker:updated', 'worker:deleted'];
  events.forEach(ev => socket.on(ev, () => {
    if (activeSection) { sectionLoaded[activeSection] = false; loadSection(activeSection); }
  }));
}

const sectionLoaded = {};
async function loadSection(id) {
  if (sectionLoaded[id]) return;
  sectionLoaded[id] = true;
  try {
    if (id === 'admin-dashboard') await loadAdminDashboard();
    else if (id === 'admin-attendance') await loadAdminAttendance();
    else if (id === 'admin-expenses') await loadAdminExpenses();
    else if (id === 'admin-machines') await loadAdminMachines();
    else if (id === 'admin-workers') await loadAdminWorkers();
    else if (id === 'admin-reports') await loadAdminReports();
    else if (id === 'admin-backup') await loadAdminBackup();
    else if (id === 'manager-dashboard') await loadManagerDashboard();
    else if (id === 'manager-attendance') await loadManagerAttendance();
    else if (id === 'manager-expenses') await loadManagerExpenses();
  } catch (err) { console.error('Load error:', err); }
}

function renderStat(icon, value, label) {
  return `<div class="stat-card"><div class="stat-icon">${icon}</div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

function renderTable(headers, rows, emptyMsg) {
  return `<div class="table-container"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="empty-state">${emptyMsg || 'No records'}</td></tr>`}</tbody></table></div>`;
}

function renderBadge(status) {
  return `<span class="badge badge-${status}">${status.replace('_',' ')}</span>`;
}

async function loadAdminDashboard() {
  const el = document.getElementById('admin-dashboard');
  try {
    const report = await apiCall(`/api/reports/daily?date=${today()}`);
    const machines = await apiCall('/api/machines');
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
        <h2>Dashboard - ${formatDate(today())}</h2>
        <button class="btn btn-primary btn-sm" onclick="refreshAll()">Refresh</button>
      </div>
      <div class="stats-grid">
        ${renderStat('👷', `${report.attendance.present}/${report.attendance.total}`, 'Present / Total')}
        ${renderStat('💰', formatMoney(report.expenses.total), 'Expenses Today')}
        ${renderStat('📋', report.jobs.total, 'Jobs Today')}
        ${renderStat('📈', formatMoney(report.profit), 'Profit Today')}
      </div>
      <div class="card"><div class="card-header"><h2>Machines</h2></div>
        <div class="stats-grid">${machines.map(m => renderStat('🔧', m.name, m.status)).join('')}</div>
      </div>
      <div class="card"><div class="card-header"><h2>Recent Jobs</h2></div>
        ${renderTable(['Date','Machine','Customer','Location','Amount'], report.jobs.records.map(j =>
          `<tr><td>${formatDate(j.date)}</td><td>${j.machine_name}</td><td>${j.customer_name}</td><td>${j.location}</td><td>${formatMoney(j.amount)}</td></tr>`
        ), 'No jobs today')}
      </div>`;
  } catch (err) { el.innerHTML = '<div class="empty-state"><p>Loading...</p></div>'; }
}

function refreshAll() {
  Object.keys(sectionLoaded).forEach(k => sectionLoaded[k] = false);
  loadSection(activeSection);
  showToast('Refreshed!');
}

async function loadAdminAttendance() {
  const el = document.getElementById('admin-attendance');
  const workers = await apiCall('/api/workers');
  const records = await apiCall(`/api/attendance?date=${today()}`);
  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>Attendance</h2><button class="btn btn-primary btn-sm" onclick="showMarkAttendance()">+ Mark Attendance</button></div>
      <div class="filter-bar">
        <div class="form-group"><label>Date</label><input type="date" id="att-filter-date" value="${today()}" onchange="filterAttendance()"></div>
      </div>
      ${renderTable(['Worker','Date','In','Out','Status','Notes','Actions'], records.map(r =>
        `<tr><td>${r.worker_name}</td><td>${formatDate(r.date)}</td><td>${r.check_in||'-'}</td><td>${r.check_out||'-'}</td><td>${renderBadge(r.status)}</td><td>${r.notes||'-'}</td>
        <td><button class="btn btn-sm btn-primary" onclick="editAttendance(${r.id},'${r.date}','${r.check_in||''}','${r.check_out||''}','${r.status}','${(r.notes||'').replace(/'/g,"\\'")}')">Edit</button></td></tr>`
      ), 'No attendance records')}
    </div>`;
  window._workers = workers;
}

async function filterAttendance() {
  const date = document.getElementById('att-filter-date').value;
  const records = await apiCall(`/api/attendance?date=${date}`);
  document.querySelector('#admin-attendance .table-container tbody').innerHTML = records.map(r =>
    `<tr><td>${r.worker_name}</td><td>${formatDate(r.date)}</td><td>${r.check_in||'-'}</td><td>${r.check_out||'-'}</td><td>${renderBadge(r.status)}</td><td>${r.notes||'-'}</td>
    <td><button class="btn btn-sm btn-primary" onclick="editAttendance(${r.id},'${r.date}','${r.check_in||''}','${r.check_out||''}','${r.status}','${(r.notes||'').replace(/'/g,"\\'")}')">Edit</button></td></tr>`
  ).join('') || '<tr><td colspan="7" class="empty-state">No records</td></tr>';
}

function showMarkAttendance() {
  const workers = window._workers || [];
  showModal('Mark Attendance', `
    <form id="mark-att-form" onsubmit="submitAttendance(event)">
      <div class="form-group"><label>Date</label><input type="date" id="att-date" value="${today()}" required></div>
      <div class="form-group"><label>Worker</label><select id="att-worker" required>${workers.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
      <div class="form-row">
        <div class="form-group"><label>Check In</label><input type="time" id="att-checkin"></div>
        <div class="form-group"><label>Check Out</label><input type="time" id="att-checkout"></div>
      </div>
      <div class="form-group"><label>Status</label><select id="att-status"><option value="present">Present</option><option value="absent">Absent</option><option value="half_day">Half Day</option><option value="leave">Leave</option></select></div>
      <div class="form-group"><label>Notes</label><input type="text" id="att-notes" placeholder="Optional"></div>
      <div class="modal-actions"><button type="submit" class="btn btn-primary">Save</button></div>
    </form>`);
}

async function submitAttendance(e) {
  e.preventDefault();
  const data = {
    worker_id: parseInt(document.getElementById('att-worker').value),
    date: document.getElementById('att-date').value,
    check_in: document.getElementById('att-checkin').value,
    check_out: document.getElementById('att-checkout').value,
    status: document.getElementById('att-status').value,
    notes: document.getElementById('att-notes').value
  };
  try {
    await apiCall('/api/attendance', { method: 'POST', body: JSON.stringify(data) });
    showToast('Attendance saved!');
    document.querySelector('.modal-overlay').remove();
    sectionLoaded[activeSection] = false;
    loadSection(activeSection);
  } catch (err) { showToast('Error: ' + err.message); }
}

function editAttendance(id, date, checkin, checkout, status, notes) {
  showModal('Edit Attendance', `
    <form onsubmit="updateAttendance(event, ${id})">
      <div class="form-group"><label>Date</label><input type="date" id="att-date" value="${date}" required></div>
      <div class="form-row">
        <div class="form-group"><label>Check In</label><input type="time" id="att-checkin" value="${checkin}"></div>
        <div class="form-group"><label>Check Out</label><input type="time" id="att-checkout" value="${checkout}"></div>
      </div>
      <div class="form-group"><label>Status</label><select id="att-status"><option value="present" ${status==='present'?'selected':''}>Present</option><option value="absent" ${status==='absent'?'selected':''}>Absent</option><option value="half_day" ${status==='half_day'?'selected':''}>Half Day</option><option value="leave" ${status==='leave'?'selected':''}>Leave</option></select></div>
      <div class="form-group"><label>Notes</label><input type="text" id="att-notes" value="${notes}"></div>
      <div class="modal-actions"><button type="submit" class="btn btn-primary">Update</button></div>
    </form>`);
}

async function updateAttendance(e, id) {
  e.preventDefault();
  const data = { check_in: document.getElementById('att-checkin').value, check_out: document.getElementById('att-checkout').value, status: document.getElementById('att-status').value, notes: document.getElementById('att-notes').value, date: document.getElementById('att-date').value };
  try {
    await apiCall(`/api/attendance/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    showToast('Attendance updated!');
    document.querySelector('.modal-overlay').remove();
    sectionLoaded[activeSection] = false;
    loadSection(activeSection);
  } catch (err) { showToast('Error: ' + err.message); }
}

async function loadAdminExpenses() {
  const el = document.getElementById('admin-expenses');
  const records = await apiCall(`/api/expenses?from=${today()}&to=${today()}`);
  const total = records.reduce((s, r) => s + r.amount, 0);
  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>Expenses - ${formatMoney(total)} today</h2><button class="btn btn-primary btn-sm" onclick="showAddExpense()">+ Add Expense</button></div>
      <div class="filter-bar">
        <div class="form-group"><label>From</label><input type="date" id="exp-from" value="${today()}"></div>
        <div class="form-group"><label>To</label><input type="date" id="exp-to" value="${today()}"></div>
        <div class="form-group"><label>Category</label><select id="exp-cat-filter"><option value="">All</option><option>Fuel</option><option>Repair</option><option>Salary</option><option>Material</option><option>Transport</option><option>Rent</option><option>Other</option></select></div>
        <button class="btn btn-primary btn-sm" onclick="filterExpenses()">Filter</button>
      </div>
      ${renderTable(['Date','Category','Amount','Description','Machine','Actions'], records.map(r =>
        `<tr><td>${formatDate(r.date)}</td><td>${renderBadge(r.category.toLowerCase())}</td><td>${formatMoney(r.amount)}</td><td>${r.description||'-'}</td><td>${r.machine_name||'-'}</td>
        <td><button class="btn btn-sm btn-primary" onclick='editExpense(${JSON.stringify(r)})'>Edit</button> <button class="btn btn-sm btn-danger" onclick="deleteExpense(${r.id})">Del</button></td></tr>`
      ), 'No expenses today')}
    </div>`;
}

async function filterExpenses() {
  const from = document.getElementById('exp-from').value;
  const to = document.getElementById('exp-to').value;
  const cat = document.getElementById('exp-cat-filter').value;
  let url = `/api/expenses?from=${from}&to=${to}`;
  if (cat) url += '&category=' + cat;
  const records = await apiCall(url);
  document.querySelector('#admin-expenses .table-container tbody').innerHTML = records.map(r =>
    `<tr><td>${formatDate(r.date)}</td><td>${renderBadge(r.category.toLowerCase())}</td><td>${formatMoney(r.amount)}</td><td>${r.description||'-'}</td><td>${r.machine_name||'-'}</td>
    <td><button class="btn btn-sm btn-primary" onclick='editExpense(${JSON.stringify(r)})'>Edit</button> <button class="btn btn-sm btn-danger" onclick="deleteExpense(${r.id})">Del</button></td></tr>`
  ).join('') || '<tr><td colspan="6" class="empty-state">No expenses</td></tr>';
}

function showAddExpense() {
  showModal('Add Expense', `
    <form onsubmit="submitExpense(event)">
      <div class="form-row">
        <div class="form-group"><label>Date</label><input type="date" id="exp-date" value="${today()}" required></div>
        <div class="form-group"><label>Category</label><select id="exp-cat" required><option>Fuel</option><option>Repair</option><option>Salary</option><option>Material</option><option>Transport</option><option>Rent</option><option>Other</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Amount (₹)</label><input type="number" id="exp-amount" required min="0" step="0.01"></div>
        <div class="form-group"><label>Machine</label><select id="exp-machine"><option value="">None</option></select></div>
      </div>
      <div class="form-group"><label>Description</label><input type="text" id="exp-desc" placeholder="What for?"></div>
      <div class="modal-actions"><button type="submit" class="btn btn-primary">Save</button></div>
    </form>`);
  loadMachineSelect('exp-machine');
}

async function submitExpense(e) {
  e.preventDefault();
  const data = { date: document.getElementById('exp-date').value, category: document.getElementById('exp-cat').value, amount: parseFloat(document.getElementById('exp-amount').value), description: document.getElementById('exp-desc').value, machine_id: parseInt(document.getElementById('exp-machine').value) || null };
  try {
    await apiCall('/api/expenses', { method: 'POST', body: JSON.stringify(data) });
    showToast('Expense added!');
    document.querySelector('.modal-overlay').remove();
    sectionLoaded[activeSection] = false;
    loadSection(activeSection);
  } catch (err) { showToast('Error: ' + err.message); }
}

function editExpense(r) {
  showModal('Edit Expense', `
    <form onsubmit="updateExpense(event, ${r.id})">
      <div class="form-row">
        <div class="form-group"><label>Date</label><input type="date" id="exp-date" value="${r.date}" required></div>
        <div class="form-group"><label>Category</label><select id="exp-cat" required><option ${r.category==='Fuel'?'selected':''}>Fuel</option><option ${r.category==='Repair'?'selected':''}>Repair</option><option ${r.category==='Salary'?'selected':''}>Salary</option><option ${r.category==='Material'?'selected':''}>Material</option><option ${r.category==='Transport'?'selected':''}>Transport</option><option ${r.category==='Rent'?'selected':''}>Rent</option><option ${r.category==='Other'?'selected':''}>Other</option></select></div>
      </div>
      <div class="form-group"><label>Amount (₹)</label><input type="number" id="exp-amount" value="${r.amount}" required min="0" step="0.01"></div>
      <div class="form-group"><label>Description</label><input type="text" id="exp-desc" value="${r.description||''}"></div>
      <div class="modal-actions"><button type="submit" class="btn btn-primary">Update</button></div>
    </form>`);
}

async function updateExpense(e, id) {
  e.preventDefault();
  const data = { date: document.getElementById('exp-date').value, category: document.getElementById('exp-cat').value, amount: parseFloat(document.getElementById('exp-amount').value), description: document.getElementById('exp-desc').value, machine_id: null };
  try {
    await apiCall(`/api/expenses/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    showToast('Expense updated!');
    document.querySelector('.modal-overlay').remove();
    sectionLoaded[activeSection] = false;
    loadSection(activeSection);
  } catch (err) { showToast('Error: ' + err.message); }
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  try { await apiCall(`/api/expenses/${id}`, { method: 'DELETE' }); showToast('Deleted'); sectionLoaded[activeSection] = false; loadSection(activeSection); } catch (err) { showToast('Error'); }
}

async function loadAdminMachines() {
  const el = document.getElementById('admin-machines');
  const machines = await apiCall('/api/machines');
  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>Machines</h2><button class="btn btn-primary btn-sm" onclick="showAddMachine()">+ Add Machine</button></div>
      <div class="stats-grid">${machines.map(m => `
        <div class="stat-card" style="cursor:pointer" onclick='showEditMachine(${JSON.stringify(m).replace(/'/g,"&#39;")})'>
          <div class="stat-icon">🔧</div>
          <div class="stat-value" style="font-size:18px">${m.name}</div>
          <div class="stat-label">${renderBadge(m.status)}</div>
          <div class="stat-label">${m.type}</div>
        </div>`).join('')}
      </div>
    </div>`;
}

function showAddMachine() {
  showModal('Add Machine', `
    <form onsubmit="submitMachine(event)">
      <div class="form-group"><label>Name</label><input type="text" id="mac-name" required placeholder="e.g. Machine 3"></div>
      <div class="form-group"><label>Type</label><select id="mac-type"><option value="borwell">Borwell</option><option value="rig">Rig</option><option value="other">Other</option></select></div>
      <div class="form-group"><label>Status</label><select id="mac-status"><option value="active">Active</option><option value="maintenance">Maintenance</option></select></div>
      <div class="modal-actions"><button type="submit" class="btn btn-primary">Save</button></div>
    </form>`);
}

async function submitMachine(e) {
  e.preventDefault();
  const data = { name: document.getElementById('mac-name').value, type: document.getElementById('mac-type').value, status: document.getElementById('mac-status').value };
  try { await apiCall('/api/machines', { method: 'POST', body: JSON.stringify(data) }); showToast('Machine added!'); document.querySelector('.modal-overlay').remove(); sectionLoaded[activeSection] = false; loadSection(activeSection); } catch (err) { showToast('Error'); }
}

function showEditMachine(m) {
  showModal('Edit Machine', `
    <form onsubmit="updateMachine(event, ${m.id})">
      <div class="form-group"><label>Name</label><input type="text" id="mac-name" value="${m.name}" required></div>
      <div class="form-group"><label>Type</label><select id="mac-type"><option value="borwell" ${m.type==='borwell'?'selected':''}>Borwell</option><option value="rig" ${m.type==='rig'?'selected':''}>Rig</option><option value="other" ${m.type==='other'?'selected':''}>Other</option></select></div>
      <div class="form-group"><label>Status</label><select id="mac-status"><option value="active" ${m.status==='active'?'selected':''}>Active</option><option value="maintenance" ${m.status==='maintenance'?'selected':''}>Maintenance</option></select></div>
      <div class="modal-actions"><button type="submit" class="btn btn-primary">Update</button></div>
    </form>`);
}

async function updateMachine(e, id) {
  e.preventDefault();
  const data = { name: document.getElementById('mac-name').value, type: document.getElementById('mac-type').value, status: document.getElementById('mac-status').value };
  try { await apiCall(`/api/machines/${id}`, { method: 'PUT', body: JSON.stringify(data) }); showToast('Updated!'); document.querySelector('.modal-overlay').remove(); sectionLoaded[activeSection] = false; loadSection(activeSection); } catch (err) { showToast('Error'); }
}

async function loadAdminWorkers() {
  const el = document.getElementById('admin-workers');
  const workers = await apiCall('/api/workers');
  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>Workers</h2><button class="btn btn-primary btn-sm" onclick="showAddWorker()">+ Add Worker</button></div>
      ${renderTable(['Name','Phone','Role','Machine','Status','Actions'], workers.map(w =>
        `<tr><td>${w.name}</td><td>${w.phone||'-'}</td><td>${w.role}</td><td>${w.machine_name||'-'}</td><td>${renderBadge(w.active?'active':'absent')}</td>
        <td><button class="btn btn-sm btn-primary" onclick='editWorker(${JSON.stringify(w).replace(/'/g,"&#39;")})'>Edit</button></td></tr>`
      ), 'No workers')}
    </div>`;
  window._workers = workers;
}

function showAddWorker() {
  showModal('Add Worker', `
    <form onsubmit="submitWorker(event)">
      <div class="form-group"><label>Name</label><input type="text" id="wk-name" required></div>
      <div class="form-row">
        <div class="form-group"><label>Phone</label><input type="tel" id="wk-phone"></div>
        <div class="form-group"><label>Role</label><select id="wk-role"><option value="worker">Worker</option><option value="operator">Operator</option><option value="helper">Helper</option></select></div>
      </div>
      <div class="form-group"><label>Machine</label><select id="wk-machine"><option value="">None</option></select></div>
      <div class="modal-actions"><button type="submit" class="btn btn-primary">Save</button></div>
    </form>`);
  loadMachineSelect('wk-machine');
}

async function submitWorker(e) {
  e.preventDefault();
  const data = { name: document.getElementById('wk-name').value, phone: document.getElementById('wk-phone').value, role: document.getElementById('wk-role').value, machine_id: parseInt(document.getElementById('wk-machine').value) || null };
  try { await apiCall('/api/workers', { method: 'POST', body: JSON.stringify(data) }); showToast('Worker added!'); document.querySelector('.modal-overlay').remove(); sectionLoaded[activeSection] = false; loadSection(activeSection); } catch (err) { showToast('Error'); }
}

function editWorker(w) {
  showModal('Edit Worker', `
    <form onsubmit="updateWorker(event, ${w.id})">
      <div class="form-group"><label>Name</label><input type="text" id="wk-name" value="${w.name}" required></div>
      <div class="form-row">
        <div class="form-group"><label>Phone</label><input type="tel" id="wk-phone" value="${w.phone||''}"></div>
        <div class="form-group"><label>Role</label><select id="wk-role"><option value="worker" ${w.role==='worker'?'selected':''}>Worker</option><option value="operator" ${w.role==='operator'?'selected':''}>Operator</option><option value="helper" ${w.role==='helper'?'selected':''}>Helper</option></select></div>
      </div>
      <div class="form-group"><label>Machine</label><select id="wk-machine"><option value="">None</option></select></div>
      <div class="form-group"><label>Status</label><select id="wk-active"><option value="1" ${w.active?'selected':''}>Active</option><option value="0" ${!w.active?'selected':''}>Inactive</option></select></div>
      <div class="modal-actions"><button type="submit" class="btn btn-primary">Update</button></div>
    </form>`);
  loadMachineSelect('wk-machine', w.machine_id);
}

async function updateWorker(e, id) {
  e.preventDefault();
  const data = { name: document.getElementById('wk-name').value, phone: document.getElementById('wk-phone').value, role: document.getElementById('wk-role').value, machine_id: parseInt(document.getElementById('wk-machine').value) || null, active: parseInt(document.getElementById('wk-active').value) };
  try { await apiCall(`/api/workers/${id}`, { method: 'PUT', body: JSON.stringify(data) }); showToast('Updated!'); document.querySelector('.modal-overlay').remove(); sectionLoaded[activeSection] = false; loadSection(activeSection); } catch (err) { showToast('Error'); }
}

async function loadMachineSelect(selectId, selectedId) {
  try {
    const machines = await apiCall('/api/machines');
    const sel = document.getElementById(selectId);
    if (!sel) return;
    machines.forEach(m => { const opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.name; if (m.id === selectedId) opt.selected = true; sel.appendChild(opt); });
  } catch (e) {}
}

async function loadAdminReports() {
  const el = document.getElementById('admin-reports');
  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>Reports</h2></div>
      <div class="filter-bar">
        <div class="form-group"><select id="report-type" onchange="loadReportData()"><option value="daily">Daily</option><option value="monthly">Monthly</option></select></div>
        <div class="form-group" id="report-date-group"><input type="date" id="report-date" value="${today()}" onchange="loadReportData()"></div>
      </div>
      <div id="report-content"></div>
    </div>`;
  loadReportData();
}

async function loadReportData() {
  const type = document.getElementById('report-type').value;
  const content = document.getElementById('report-content');
  try {
    if (type === 'daily') {
      const date = document.getElementById('report-date').value;
      document.getElementById('report-date-group').style.display = '';
      const r = await apiCall(`/api/reports/daily?date=${date}`);
      content.innerHTML = `<div class="stats-grid">
        ${renderStat('✅', `${r.attendance.present}/${r.attendance.total}`, 'Present / Total')}
        ${renderStat('💰', formatMoney(r.expenses.total), 'Expenses')}
        ${renderStat('📋', r.jobs.total, 'Jobs')}
        ${renderStat('📈', formatMoney(r.profit), 'Profit')}
      </div>`;
    } else {
      document.getElementById('report-date-group').style.display = 'none';
      const now = new Date();
      const r = await apiCall(`/api/reports/monthly?month=${now.getMonth()+1}&year=${now.getFullYear()}`);
      content.innerHTML = `<div class="stats-grid">
        ${renderStat('💰', formatMoney(r.totalIncome), 'Income')}
        ${renderStat('💸', formatMoney(r.totalExpense), 'Expenses')}
        ${renderStat('📈', formatMoney(r.profit), 'Net Profit')}
        ${renderStat('📋', r.jobs_count, 'Jobs')}
      </div><div class="card"><h3 style="margin-bottom:10px">Expense Breakdown</h3>${r.expenses.map(e => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee"><span>${e.category}</span><strong>${formatMoney(e.total)}</strong></div>`).join('')}</div>`;
    }
  } catch (err) { content.innerHTML = '<p>Error loading report</p>'; }
}

async function loadAdminBackup() {
  const el = document.getElementById('admin-backup');
  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>Backup & Restore</h2></div>
      <div class="stats-grid">
        <div class="stat-card" style="cursor:pointer" onclick="backupNow()"><div class="stat-icon">☁️</div><div class="stat-value" style="font-size:16px">Backup Now</div><div class="stat-label">Save to Google Drive</div></div>
        <div class="stat-card" style="cursor:pointer" onclick="downloadBackup()"><div class="stat-icon">📥</div><div class="stat-value" style="font-size:16px">Download</div><div class="stat-label">Download JSON file</div></div>
      </div>
      <div style="margin-top:16px"><h3>Restore</h3><input type="file" id="restore-file" accept=".json" style="margin:10px 0"><button class="btn btn-warning btn-sm" onclick="restoreBackup()">Restore</button></div>
    </div>`;
}

async function backupNow() { try { showToast('Backing up...'); const r = await apiCall('/api/backup/now', { method: 'POST' }); showToast(r.message); } catch (err) { showToast('Backup failed'); } }

async function downloadBackup() {
  try {
    const data = await apiCall('/api/backup/download');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `borwell_${today()}.json`; a.click();
    showToast('Downloaded!');
  } catch (err) { showToast('Failed'); }
}

async function restoreBackup() {
  const fi = document.getElementById('restore-file');
  if (!fi.files.length) { showToast('Select file first'); return; }
  if (!confirm('This replaces ALL data. Sure?')) return;
  try { const data = JSON.parse(await fi.files[0].text()); await apiCall('/api/backup/restore', { method: 'POST', body: JSON.stringify({ data }) }); showToast('Restored!'); location.reload(); } catch (err) { showToast('Failed'); }
}

async function loadManagerDashboard() {
  const el = document.getElementById('manager-dashboard');
  try {
    const r = await apiCall(`/api/reports/daily?date=${today()}`);
    el.innerHTML = `<h2 style="margin-bottom:20px">Dashboard - ${formatDate(today())}</h2>
      <div class="stats-grid">
        ${renderStat('👷', `${r.attendance.present}/${r.attendance.total}`, 'Present / Total')}
        ${renderStat('💰', formatMoney(r.expenses.total), 'Expenses')}
        ${renderStat('📋', r.jobs.total, 'Jobs')}
      </div>`;
  } catch (err) { el.innerHTML = '<p>Loading...</p>'; }
}

async function loadManagerAttendance() {
  const el = document.getElementById('manager-attendance');
  const workers = await apiCall('/api/workers');
  window._workers = workers;
  const records = await apiCall(`/api/attendance?date=${today()}`);
  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>Edit Attendance</h2><button class="btn btn-primary btn-sm" onclick="showMarkAttendance()">+ Mark</button></div>
      <div class="filter-bar"><div class="form-group"><input type="date" id="att-filter-date" value="${today()}" onchange="filterManagerAttendance()"></div></div>
      ${renderTable(['Worker','Date','In','Out','Status','Actions'], records.map(r =>
        `<tr><td>${r.worker_name}</td><td>${formatDate(r.date)}</td><td>${r.check_in||'-'}</td><td>${r.check_out||'-'}</td><td>${renderBadge(r.status)}</td>
        <td><button class="btn btn-sm btn-primary" onclick="editAttendance(${r.id},'${r.date}','${r.check_in||''}','${r.check_out||''}','${r.status}','${(r.notes||'').replace(/'/g,"\\'")}')">Edit</button></td></tr>`
      ), 'No records')}
    </div>`;
}

async function filterManagerAttendance() {
  const date = document.getElementById('att-filter-date').value;
  const records = await apiCall(`/api/attendance?date=${date}`);
  document.querySelector('#manager-attendance .table-container tbody').innerHTML = records.map(r =>
    `<tr><td>${r.worker_name}</td><td>${formatDate(r.date)}</td><td>${r.check_in||'-'}</td><td>${r.check_out||'-'}</td><td>${renderBadge(r.status)}</td>
    <td><button class="btn btn-sm btn-primary" onclick="editAttendance(${r.id},'${r.date}','${r.check_in||''}','${r.check_out||''}','${r.status}','${(r.notes||'').replace(/'/g,"\\'")}')">Edit</button></td></tr>`
  ).join('') || '<tr><td colspan="6" class="empty-state">No records</td></tr>';
}

async function loadManagerExpenses() {
  const el = document.getElementById('manager-expenses');
  const records = await apiCall(`/api/expenses?from=${today()}&to=${today()}`);
  const total = records.reduce((s, r) => s + r.amount, 0);
  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>Expenses - ${formatMoney(total)}</h2><button class="btn btn-primary btn-sm" onclick="showAddExpense()">+ Add</button></div>
      ${renderTable(['Date','Category','Amount','Description','Actions'], records.map(r =>
        `<tr><td>${formatDate(r.date)}</td><td>${r.category}</td><td>${formatMoney(r.amount)}</td><td>${r.description||'-'}</td>
        <td><button class="btn btn-sm btn-primary" onclick='editExpense(${JSON.stringify(r)})'>Edit</button></td></tr>`
      ), 'No expenses today')}
    </div>`;
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.classList.remove('show');
  try {
    const result = await apiCall('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: document.getElementById('login-username').value, password: document.getElementById('login-password').value }) });
    authToken = result.token;
    currentUser = result.user;
    localStorage.setItem('borwell_token', authToken);
    localStorage.setItem('borwell_user', JSON.stringify(currentUser));
    showDashboard(currentUser);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('show');
  }
});

function showDashboard(user) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  Object.keys(sectionLoaded).forEach(k => sectionLoaded[k] = false);
  if (user.role === 'admin') {
    document.getElementById('admin-page').classList.add('active');
    document.getElementById('admin-username').textContent = user.fullname;
    loadSection('admin-dashboard');
  } else {
    document.getElementById('manager-page').classList.add('active');
    document.getElementById('manager-username').textContent = user.fullname;
    loadSection('manager-dashboard');
  }
  initSocket();
}

function logout() {
  if (socket) socket.disconnect();
  authToken = null;
  currentUser = null;
  localStorage.removeItem('borwell_token');
  localStorage.removeItem('borwell_user');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('login-page').classList.add('active');
}

window.addEventListener('load', () => {
  const saved = localStorage.getItem('borwell_user');
  const token = localStorage.getItem('borwell_token');
  if (saved && token) { currentUser = JSON.parse(saved); authToken = token; showDashboard(currentUser); }
});
