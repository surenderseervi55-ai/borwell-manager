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
  const { worker_id } = req.query;
  let query = 'SELECT ws.*, w.name as worker_name FROM worker_salaries ws JOIN workers w ON ws.worker_id = w.id WHERE 1=1';
  const params = [];
  if (worker_id) { query += ' AND ws.worker_id = ?'; params.push(worker_id); }
  query += ' ORDER BY ws.effective_from DESC';
  res.json(getAll(query, params));
});

router.post('/', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { worker_id, per_day_rate, monthly_fixed, salary_type, effective_from, effective_to } = req.body;
  runQuery('UPDATE worker_salaries SET effective_to = ? WHERE worker_id = ? AND (effective_to IS NULL OR effective_to > ?)', [effective_from, worker_id, effective_from]);
  const result = runQuery('INSERT INTO worker_salaries (worker_id, per_day_rate, monthly_fixed, salary_type, effective_from, effective_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [worker_id, per_day_rate || 0, monthly_fixed || 0, salary_type || 'per_day', effective_from, effective_to, req.user.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('salary:config:added', { id: result.lastInsertRowid, worker_id });
  res.json({ id: result.lastInsertRowid, message: 'Salary config added' });
});

router.put('/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { worker_id, per_day_rate, monthly_fixed, salary_type, effective_from, effective_to } = req.body;
  runQuery('UPDATE worker_salaries SET worker_id=?, per_day_rate=?, monthly_fixed=?, salary_type=?, effective_from=?, effective_to=? WHERE id=?', [worker_id, per_day_rate, monthly_fixed, salary_type, effective_from, effective_to, req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('salary:config:updated', { id: req.params.id });
  res.json({ message: 'Salary config updated' });
});

router.delete('/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  runQuery('DELETE FROM worker_salaries WHERE id = ?', [req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('salary:config:deleted', { id: req.params.id });
  res.json({ message: 'Salary config deleted' });
});

module.exports = router;