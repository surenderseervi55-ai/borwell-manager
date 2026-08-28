const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { runQuery, getAll, getOne } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'borwell_secret';

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { res.status(401).json({ error: 'Invalid token' }); }
}

router.get('/', auth, (req, res) => {
  const { date, worker_id, from, to } = req.query;
  let query = 'SELECT a.*, w.name as worker_name FROM attendance a JOIN workers w ON a.worker_id = w.id WHERE 1=1';
  const params = [];
  if (date) { query += ' AND a.date = ?'; params.push(date); }
  if (worker_id) { query += ' AND a.worker_id = ?'; params.push(worker_id); }
  if (from && to) { query += ' AND a.date BETWEEN ? AND ?'; params.push(from, to); }
  query += ' ORDER BY a.date DESC, w.name';
  res.json(getAll(query, params));
});

router.post('/', auth, (req, res) => {
  const { worker_id, date, check_in, check_out, status, notes } = req.body;
  const existing = getOne('SELECT id FROM attendance WHERE worker_id = ? AND date = ?', [worker_id, date]);
  if (existing) {
    runQuery('UPDATE attendance SET check_in=?, check_out=?, status=?, notes=?, marked_by=? WHERE id=?', [check_in, check_out, status, notes, req.user.id, existing.id]);
    if (req.app.get('broadcast')) req.app.get('broadcast')('attendance:updated', { worker_id, date, status });
    res.json({ message: 'Attendance updated', id: existing.id });
  } else {
    const result = runQuery('INSERT INTO attendance (worker_id, date, check_in, check_out, status, notes, marked_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [worker_id, date, check_in, check_out, status || 'present', notes, req.user.id]);
    if (req.app.get('broadcast')) req.app.get('broadcast')('attendance:added', { id: result.lastInsertRowid, worker_id, date, status });
    res.json({ id: result.lastInsertRowid, message: 'Attendance marked' });
  }
});

router.post('/bulk', auth, (req, res) => {
  const { date, records } = req.body;
  for (const r of records) {
    const existing = getOne('SELECT id FROM attendance WHERE worker_id = ? AND date = ?', [r.worker_id, date]);
    if (existing) {
      runQuery('UPDATE attendance SET check_in=?, check_out=?, status=?, notes=?, marked_by=? WHERE worker_id=? AND date=?', [r.check_in, r.check_out, r.status, r.notes, req.user.id, r.worker_id, date]);
    } else {
      runQuery('INSERT INTO attendance (worker_id, date, check_in, check_out, status, notes, marked_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [r.worker_id, date, r.check_in, r.check_out, r.status || 'present', r.notes, req.user.id]);
    }
  }
  if (req.app.get('broadcast')) req.app.get('broadcast')('attendance:bulk', { date, count: records.length });
  res.json({ message: 'Bulk attendance saved' });
});

router.put('/:id', auth, (req, res) => {
  const { check_in, check_out, status, notes } = req.body;
  runQuery('UPDATE attendance SET check_in=?, check_out=?, status=?, notes=? WHERE id=?', [check_in, check_out, status, notes, req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('attendance:updated', { id: req.params.id, status });
  res.json({ message: 'Attendance updated' });
});

router.delete('/:id', auth, (req, res) => {
  runQuery('DELETE FROM attendance WHERE id = ?', [req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('attendance:deleted', { id: req.params.id });
  res.json({ message: 'Attendance deleted' });
});

module.exports = router;
