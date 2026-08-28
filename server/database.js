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
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  saveDb();
  return db;
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
