const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { runQuery, getAll } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'borwell_secret';

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { res.status(401).json({ error: 'Invalid token' }); }
}

router.post('/push', auth, (req, res) => {
  const { changes } = req.body;
  if (!changes || !Array.isArray(changes)) return res.status(400).json({ error: 'Invalid changes array' });

  const tableMap = {
    attendance: { sql: 'INSERT OR REPLACE INTO attendance (id, worker_id, date, check_in, check_out, status, notes, marked_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', fields: ['id', 'worker_id', 'date', 'check_in', 'check_out', 'status', 'notes', 'marked_by'] },
    expenses: { sql: 'INSERT OR REPLACE INTO expenses (id, date, category, amount, description, machine_id, added_by) VALUES (?, ?, ?, ?, ?, ?, ?)', fields: ['id', 'date', 'category', 'amount', 'description', 'machine_id', 'added_by'] },
    jobs: { sql: 'INSERT OR REPLACE INTO jobs (id, date, machine_id, customer_name, location, work_description, depth_feet, status, amount, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', fields: ['id', 'date', 'machine_id', 'customer_name', 'location', 'work_description', 'depth_feet', 'status', 'amount', 'created_by'] },
    workers: { sql: 'INSERT OR REPLACE INTO workers (id, name, phone, role, machine_id, active) VALUES (?, ?, ?, ?, ?, ?)', fields: ['id', 'name', 'phone', 'role', 'machine_id', 'active'] },
  };

  let synced = 0;
  for (const change of changes) {
    const mapping = tableMap[change.table];
    if (!mapping) continue;
    const values = mapping.fields.map(f => change.data[f]);
    try {
      runQuery(mapping.sql, values);
      synced++;
    } catch (e) {
      console.log(`Sync error for ${change.table}:`, e.message);
    }
  }
  res.json({ message: `${synced} records synced`, synced });
});

router.get('/pull', auth, (req, res) => {
  res.json([]);
});

module.exports = router;
