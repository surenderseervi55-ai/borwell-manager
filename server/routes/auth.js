const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { runQuery, getAll, getOne } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'borwell_secret';

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = getOne('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role, fullname: user.fullname }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, fullname: user.fullname } });
});

router.post('/register', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { username, password, fullname, role, phone } = req.body;
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = runQuery('INSERT INTO users (username, password, fullname, role, phone) VALUES (?, ?, ?, ?, ?)', [username, hash, fullname, role || 'manager', phone]);
    res.json({ id: result.lastInsertRowid, message: 'User created' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/users', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const users = getAll('SELECT id, username, fullname, role, phone, created_at FROM users');
  res.json(users);
});

router.get('/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

module.exports = router;
