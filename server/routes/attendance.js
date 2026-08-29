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
  const { date, worker_id, from, to, auto } = req.query;
  // Auto-present: if date provided, no records, and auto-present enabled (or auto=1 forced), mark all active workers as present
  if (date && !worker_id && !from) {
    const setting = getOne('SELECT value FROM settings WHERE key=?', ['auto_present']);
    const autoEnabled = setting ? setting.value === '1' : true;
    const existing = getAll('SELECT id FROM attendance WHERE date = ?', [date]);
    if (existing.length === 0 && (autoEnabled || auto === '1')) {
      const workers = getAll('SELECT id FROM workers WHERE active = 1');
      for (const w of workers) {
        runQuery('INSERT INTO attendance (worker_id, date, check_in, check_out, status, notes, marked_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [w.id, date, '09:00', '18:00', 'present', 'Auto present', req.user.id]);
      }
      if (workers.length && req.app.get('broadcast')) req.app.get('broadcast')('attendance:bulk', { date, count: workers.length });
    }
  }
  let query = 'SELECT a.*, w.name as worker_name FROM attendance a JOIN workers w ON a.worker_id = w.id WHERE 1=1';
  const params = [];
  if (date) { query += ' AND a.date = ?'; params.push(date); }
  if (worker_id) { query += ' AND a.worker_id = ?'; params.push(worker_id); }
  if (from && to) { query += ' AND a.date BETWEEN ? AND ?'; params.push(from, to); }
  query += ' ORDER BY a.date DESC, w.name';
  res.json(getAll(query, params));
});

router.post('/auto-present', auth, (req, res) => {
  const { date } = req.body;
  const d = date || new Date().toISOString().split('T')[0];
  const workers = getAll('SELECT id FROM workers WHERE active = 1');
  let count = 0;
  for (const w of workers) {
    const existing = getOne('SELECT id FROM attendance WHERE worker_id = ? AND date = ?', [w.id, d]);
    if (!existing) {
      runQuery('INSERT INTO attendance (worker_id, date, check_in, check_out, status, notes, marked_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [w.id, d, '09:00', '18:00', 'present', 'Auto present', req.user.id]);
      count++;
    } else if (existing) {
      runQuery('UPDATE attendance SET status=?, check_in=?, check_out=?, notes=? WHERE id=?', ['present', '09:00', '18:00', 'Auto present', existing.id]);
      count++;
    }
  }
  if (count && req.app.get('broadcast')) req.app.get('broadcast')('attendance:bulk', { date: d, count });
  res.json({ message: `Auto present done for ${count} workers`, count });
});

router.get('/settings/auto-present', auth, (req, res) => {
  const setting = getOne('SELECT value FROM settings WHERE key=?', ['auto_present']);
  res.json({ enabled: setting ? setting.value === '1' : true });
});

router.put('/settings/auto-present', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { enabled } = req.body;
  const val = enabled ? '1' : '0';
  const existing = getOne('SELECT value FROM settings WHERE key=?', ['auto_present']);
  if (existing) runQuery('UPDATE settings SET value=? WHERE key=?', [val, 'auto_present']);
  else runQuery('INSERT INTO settings (key, value) VALUES (?, ?)', ['auto_present', val]);
  // If disabled, do not auto-create; if enabled, next attendance load will auto-present
  res.json({ enabled: val === '1', message: enabled ? 'Auto present enabled - every labour will be marked present automatically' : 'Auto present disabled - attendance stopped, mark manually' });
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
