const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'borwell.db');
let db = null;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  try {
    if (fs.existsSync(DB_PATH)) {
      const buf = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buf);
    } else {
      db = new SQL.Database();
    }
  } catch {
    db = new SQL.Database();
  }

  db.run(`PRAGMA journal_mode = WAL`);
  db.run(`PRAGMA foreign_keys = ON`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    fullname TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','manager')),
    phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    role TEXT DEFAULT 'worker',
    machine_id INTEGER,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS machines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'borwell',
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    check_in TEXT,
    check_out TEXT,
    status TEXT DEFAULT 'present' CHECK(status IN ('present','absent','half_day','leave')),
    notes TEXT,
    marked_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    machine_id INTEGER,
    added_by INTEGER,
    attachment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    machine_id INTEGER NOT NULL,
    customer_name TEXT,
    location TEXT,
    work_description TEXT,
    depth_feet INTEGER,
    status TEXT DEFAULT 'completed',
    amount REAL DEFAULT 0,
    received REAL DEFAULT 0,
    pending REAL DEFAULT 0,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_number TEXT UNIQUE NOT NULL,
    date TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    machine_id INTEGER,
    job_id INTEGER,
    total_amount REAL NOT NULL,
    received_amount REAL DEFAULT 0,
    pending_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','partial','paid','cancelled')),
    notes TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bill_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_date TEXT NOT NULL,
    payment_mode TEXT DEFAULT 'cash',
    notes TEXT,
    received_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bill_id) REFERENCES bills(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS worker_salaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    per_day_rate REAL DEFAULT 0,
    monthly_fixed REAL DEFAULT 0,
    salary_type TEXT DEFAULT 'per_day' CHECK(salary_type IN ('per_day','monthly')),
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (worker_id) REFERENCES workers(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS salary_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    salary_period_from TEXT NOT NULL,
    salary_period_to TEXT NOT NULL,
    days_worked INTEGER DEFAULT 0,
    gross_salary REAL DEFAULT 0,
    advance_deducted REAL DEFAULT 0,
    net_paid REAL DEFAULT 0,
    payment_date TEXT,
    payment_mode TEXT DEFAULT 'cash',
    notes TEXT,
    attachment TEXT,
    paid_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (worker_id) REFERENCES workers(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS advances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    attachment TEXT,
    given_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (worker_id) REFERENCES workers(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS capital (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    source TEXT,
    description TEXT,
    added_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  // Default: auto-present enabled
  try {
    const exists = db.exec(`SELECT value FROM settings WHERE key='auto_present'`);
    if (!exists.length || !exists[0].values.length) {
      db.run(`INSERT INTO settings (key, value) VALUES ('auto_present', '1')`);
    }
  } catch(e) {}

  // Migrations for old DBs
  try { db.run(`ALTER TABLE expenses ADD COLUMN attachment TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE jobs ADD COLUMN received REAL DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE jobs ADD COLUMN pending REAL DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE salary_payments ADD COLUMN attachment TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE advances ADD COLUMN attachment TEXT`); } catch(e) {}

  saveDb();

  // Auto-restore from Drive backup if local DB is empty (fresh deploy on Render free tier)
  try {
    const userCount = db.exec(`SELECT COUNT(*) as c FROM users`)[0]?.values[0][0] || 0;
    if (userCount === 0) {
      const restored = await tryRestoreFromDrive();
      if (restored) {
        console.log('Restored DB from Drive backup');
        saveDb();
      }
    }
  } catch(e) { console.log('Restore check failed:', e.message); }

  return db;
}

async function tryRestoreFromDrive() {
  try {
    const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!keyPath || keyPath === 'path_to_service_account.json' || !folderId || folderId === 'your_folder_id_here') return false;
    if (!fs.existsSync(keyPath)) return false;
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({ keyFile: keyPath, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
    const drive = google.drive({ version: 'v3', auth });
    const res = await drive.files.list({ q: `'${folderId}' in parents and name contains 'borwell_backup' and trashed=false`, orderBy: 'createdTime desc', pageSize: 1, fields: 'files(id, name)' });
    if (!res.data.files.length) return false;
    const fileId = res.data.files[0].id;
    const file = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    const data = JSON.parse(Buffer.from(file.data).toString());
    if (!data.workers && !data.bills) return false;
    // Restore
    if (data.users) { db.run('DELETE FROM users'); for (const u of data.users) db.run('INSERT INTO users (id, username, password, fullname, role, phone, created_at) VALUES (?,?,?,?,?,?,?)', [u.id, u.username, u.password, u.fullname, u.role, u.phone, u.created_at]); }
    if (data.workers) { db.run('DELETE FROM workers'); for (const w of data.workers) db.run('INSERT INTO workers (id, name, phone, role, machine_id, active, created_at) VALUES (?,?,?,?,?,?,?)', [w.id, w.name, w.phone, w.role, w.machine_id, w.active, w.created_at]); }
    if (data.machines) { db.run('DELETE FROM machines'); for (const m of data.machines) db.run('INSERT INTO machines (id, name, type, status, created_at) VALUES (?,?,?,?,?)', [m.id, m.name, m.type, m.status, m.created_at]); }
    if (data.attendance) { db.run('DELETE FROM attendance'); for (const a of data.attendance) db.run('INSERT INTO attendance (id, worker_id, date, check_in, check_out, status, notes, marked_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [a.id, a.worker_id, a.date, a.check_in, a.check_out, a.status, a.notes, a.marked_by, a.created_at]); }
    if (data.expenses) { db.run('DELETE FROM expenses'); for (const e of data.expenses) db.run('INSERT INTO expenses (id, date, category, amount, description, machine_id, added_by, attachment, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [e.id, e.date, e.category, e.amount, e.description, e.machine_id, e.added_by, e.attachment, e.created_at]); }
    if (data.jobs) { db.run('DELETE FROM jobs'); for (const j of data.jobs) db.run('INSERT INTO jobs (id, date, machine_id, customer_name, location, work_description, depth_feet, status, amount, received, pending, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [j.id, j.date, j.machine_id, j.customer_name, j.location, j.work_description, j.depth_feet, j.status, j.amount, j.received, j.pending, j.created_by, j.created_at]); }
    if (data.bills) { db.run('DELETE FROM bills'); for (const b of data.bills) db.run('INSERT INTO bills (id, bill_number, date, customer_name, customer_phone, machine_id, job_id, total_amount, received_amount, pending_amount, status, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [b.id, b.bill_number, b.date, b.customer_name, b.customer_phone, b.machine_id, b.job_id, b.total_amount, b.received_amount, b.pending_amount, b.status, b.notes, b.created_by, b.created_at]); }
    if (data.bill_payments) { try { db.run('DELETE FROM bill_payments'); for (const bp of data.bill_payments) db.run('INSERT INTO bill_payments (id, bill_id, amount, payment_date, payment_mode, notes, received_by, created_at) VALUES (?,?,?,?,?,?,?,?)', [bp.id, bp.bill_id, bp.amount, bp.payment_date, bp.payment_mode, bp.notes, bp.received_by, bp.created_at]); } catch(e){} }
    if (data.worker_salaries) { try { db.run('DELETE FROM worker_salaries'); for (const ws of data.worker_salaries) db.run('INSERT INTO worker_salaries (id, worker_id, per_day_rate, monthly_fixed, salary_type, effective_from, effective_to, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [ws.id, ws.worker_id, ws.per_day_rate, ws.monthly_fixed, ws.salary_type, ws.effective_from, ws.effective_to, ws.created_by, ws.created_at]); } catch(e){} }
    if (data.salary_payments) { try { db.run('DELETE FROM salary_payments'); for (const sp of data.salary_payments) db.run('INSERT INTO salary_payments (id, worker_id, salary_period_from, salary_period_to, days_worked, gross_salary, advance_deducted, net_paid, payment_date, payment_mode, notes, attachment, paid_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [sp.id, sp.worker_id, sp.salary_period_from, sp.salary_period_to, sp.days_worked, sp.gross_salary, sp.advance_deducted, sp.net_paid, sp.payment_date, sp.payment_mode, sp.notes, sp.attachment, sp.paid_by, sp.created_at]); } catch(e){} }
    if (data.advances) { try { db.run('DELETE FROM advances'); for (const a of data.advances) db.run('INSERT INTO advances (id, worker_id, amount, date, notes, attachment, given_by, created_at) VALUES (?,?,?,?,?,?,?,?)', [a.id, a.worker_id, a.amount, a.date, a.notes, a.attachment, a.given_by, a.created_at]); } catch(e){} }
    if (data.capital) { db.run('DELETE FROM capital'); for (const c of data.capital) db.run('INSERT INTO capital (id, date, amount, source, description, added_by, created_at) VALUES (?,?,?,?,?,?,?)', [c.id, c.date, c.amount, c.source, c.description, c.added_by, c.created_at]); }
    return true;
  } catch(e) { console.log('Drive restore failed:', e.message); return false; }
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function sanitizeParams(params) {
  return params.map(p => p === undefined ? null : p);
}

function runQuery(sql, params = []) {
  try {
    db.run(sql, sanitizeParams(params));
    const lastId = db.exec("SELECT last_insert_rowid() as id");
    saveDb();
    return { changes: db.getRowsModified(), lastInsertRowid: lastId[0]?.values[0][0] || 0 };
  } catch (err) {
    throw err;
  }
}

function getAll(sql, params = []) {
  const results = db.exec(sql, sanitizeParams(params));
  if (!results.length) return [];
  const cols = results[0].columns;
  return results[0].values.map(row => {
    const obj = {};
    cols.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

function getOne(sql, params = []) {
  const results = db.exec(sql, sanitizeParams(params));
  if (!results.length || !results[0].values.length) return null;
  const cols = results[0].columns;
  const row = results[0].values[0];
  const obj = {};
  cols.forEach((col, i) => obj[col] = row[i]);
  return obj;
}

module.exports = { getDb, saveDb, runQuery, getAll, getOne };
