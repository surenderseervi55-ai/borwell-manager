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
  const { worker_id, from, to } = req.query;
  let query = 'SELECT a.*, w.name as worker_name, u.fullname as given_by_name FROM advances a JOIN workers w ON a.worker_id = w.id LEFT JOIN users u ON a.given_by = u.id WHERE 1=1';
  const params = [];
  if (worker_id) { query += ' AND a.worker_id = ?'; params.push(worker_id); }
  if (from && to) { query += ' AND a.date BETWEEN ? AND ?'; params.push(from, to); }
  query += ' ORDER BY a.date DESC, a.id DESC';
  res.json(getAll(query, params));
});

router.post('/', auth, (req, res) => {
  const { worker_id, amount, date, notes } = req.body;
  const result = runQuery('INSERT INTO advances (worker_id, amount, date, notes, given_by) VALUES (?, ?, ?, ?, ?)', [worker_id, amount, date, notes, req.user.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('advance:added', { id: result.lastInsertRowid, worker_id, amount });
  res.json({ id: result.lastInsertRowid, message: 'Advance recorded' });
});

router.delete('/:id', auth, (req, res) => {
  runQuery('DELETE FROM advances WHERE id = ?', [req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('advance:deleted', { id: req.params.id });
  res.json({ message: 'Advance deleted' });
});

module.exports = router;
