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
  const { date, category, from, to, machine_id } = req.query;
  let query = 'SELECT e.*, m.name as machine_name, u.fullname as added_by_name FROM expenses e LEFT JOIN machines m ON e.machine_id = m.id LEFT JOIN users u ON e.added_by = u.id WHERE 1=1';
  const params = [];
  if (date) { query += ' AND e.date = ?'; params.push(date); }
  if (category) { query += ' AND e.category = ?'; params.push(category); }
  if (machine_id) { query += ' AND e.machine_id = ?'; params.push(machine_id); }
  if (from && to) { query += ' AND e.date BETWEEN ? AND ?'; params.push(from, to); }
  query += ' ORDER BY e.date DESC, e.id DESC';
  res.json(getAll(query, params));
});

router.post('/', auth, (req, res) => {
  const { date, category, amount, description, machine_id } = req.body;
  const result = runQuery('INSERT INTO expenses (date, category, amount, description, machine_id, added_by) VALUES (?, ?, ?, ?, ?, ?)', [date, category, amount, description, machine_id, req.user.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('expense:added', { id: result.lastInsertRowid, date, category, amount });
  res.json({ id: result.lastInsertRowid, message: 'Expense added' });
});

router.put('/:id', auth, (req, res) => {
  const { date, category, amount, description, machine_id } = req.body;
  runQuery('UPDATE expenses SET date=?, category=?, amount=?, description=?, machine_id=? WHERE id=?', [date, category, amount, description, machine_id, req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('expense:updated', { id: req.params.id });
  res.json({ message: 'Expense updated' });
});

router.delete('/:id', auth, (req, res) => {
  runQuery('DELETE FROM expenses WHERE id = ?', [req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('expense:deleted', { id: req.params.id });
  res.json({ message: 'Expense deleted' });
});

module.exports = router;
