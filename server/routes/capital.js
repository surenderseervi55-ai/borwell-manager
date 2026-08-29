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
  const { from, to } = req.query;
  let query = 'SELECT c.*, u.fullname as added_by_name FROM capital c LEFT JOIN users u ON c.added_by = u.id WHERE 1=1';
  const params = [];
  if (from && to) { query += ' AND c.date BETWEEN ? AND ?'; params.push(from, to); }
  query += ' ORDER BY c.date DESC, c.id DESC';
  res.json(getAll(query, params));
});

router.post('/', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { date, amount, source, description } = req.body;
  const result = runQuery('INSERT INTO capital (date, amount, source, description, added_by) VALUES (?, ?, ?, ?, ?)', [date, amount, source, description, req.user.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('capital:added', { id: result.lastInsertRowid, amount });
  res.json({ id: result.lastInsertRowid, message: 'Capital added' });
});

router.put('/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { date, amount, source, description } = req.body;
  runQuery('UPDATE capital SET date=?, amount=?, source=?, description=? WHERE id=?', [date, amount, source, description, req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('capital:updated', { id: req.params.id });
  res.json({ message: 'Capital updated' });
});

router.delete('/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  runQuery('DELETE FROM capital WHERE id = ?', [req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('capital:deleted', { id: req.params.id });
  res.json({ message: 'Capital deleted' });
});

module.exports = router;
