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
  const { date, machine_id, from, to } = req.query;
  let query = 'SELECT j.*, m.name as machine_name, u.fullname as created_by_name FROM jobs j JOIN machines m ON j.machine_id = m.id LEFT JOIN users u ON j.created_by = u.id WHERE 1=1';
  const params = [];
  if (date) { query += ' AND j.date = ?'; params.push(date); }
  if (machine_id) { query += ' AND j.machine_id = ?'; params.push(machine_id); }
  if (from && to) { query += ' AND j.date BETWEEN ? AND ?'; params.push(from, to); }
  query += ' ORDER BY j.date DESC, j.id DESC';
  res.json(getAll(query, params));
});

router.post('/', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { date, machine_id, customer_name, location, work_description, depth_feet, status, amount, received } = req.body;
  const rec = received || 0;
  const pending = (amount || 0) - rec;
  const result = runQuery('INSERT INTO jobs (date, machine_id, customer_name, location, work_description, depth_feet, status, amount, received, pending, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [date, machine_id, customer_name, location, work_description, depth_feet, status || 'completed', amount || 0, rec, pending, req.user.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('job:added', { id: result.lastInsertRowid, date, machine_id, customer_name, amount });
  res.json({ id: result.lastInsertRowid, message: 'Job added' });
});

router.put('/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { date, machine_id, customer_name, location, work_description, depth_feet, status, amount, received } = req.body;
  const rec = received || 0;
  const pending = (amount || 0) - rec;
  runQuery('UPDATE jobs SET date=?, machine_id=?, customer_name=?, location=?, work_description=?, depth_feet=?, status=?, amount=?, received=?, pending=? WHERE id=?', [date, machine_id, customer_name, location, work_description, depth_feet, status, amount, rec, pending, req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('job:updated', { id: req.params.id });
  res.json({ message: 'Job updated' });
});

router.delete('/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  runQuery('DELETE FROM jobs WHERE id = ?', [req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('job:deleted', { id: req.params.id });
  res.json({ message: 'Job deleted' });
});

module.exports = router;