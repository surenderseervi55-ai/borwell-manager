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

router.get('/', auth, (req, res) => {
  res.json(getAll('SELECT * FROM machines ORDER BY id'));
});

router.post('/', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { name, type, status } = req.body;
  const result = runQuery('INSERT INTO machines (name, type, status) VALUES (?, ?, ?)', [name, type || 'borwell', status || 'active']);
  res.json({ id: result.lastInsertRowid, message: 'Machine added' });
});

router.put('/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { name, type, status } = req.body;
  runQuery('UPDATE machines SET name=?, type=?, status=? WHERE id=?', [name, type, status, req.params.id]);
  res.json({ message: 'Machine updated' });
});

module.exports = router;
