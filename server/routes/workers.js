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
  const workers = getAll('SELECT w.*, m.name as machine_name FROM workers w LEFT JOIN machines m ON w.machine_id = m.id ORDER BY w.name');
  res.json(workers);
});

router.post('/', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { name, phone, role, machine_id } = req.body;
  const result = runQuery('INSERT INTO workers (name, phone, role, machine_id) VALUES (?, ?, ?, ?)', [name, phone, role || 'worker', machine_id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('worker:added', { id: result.lastInsertRowid, name });
  res.json({ id: result.lastInsertRowid, message: 'Worker added' });
});

router.put('/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { name, phone, role, machine_id, active } = req.body;
  runQuery('UPDATE workers SET name=?, phone=?, role=?, machine_id=?, active=? WHERE id=?', [name, phone, role, machine_id, active ?? 1, req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('worker:updated', { id: req.params.id, name });
  res.json({ message: 'Worker updated' });
});

router.delete('/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  runQuery('UPDATE workers SET active = 0 WHERE id = ?', [req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('worker:deleted', { id: req.params.id });
  res.json({ message: 'Worker deactivated' });
});

module.exports = router;
