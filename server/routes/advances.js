const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { runQuery, getAll, getOne } = require('../database');

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

function toBase64(file) {
  if (!file) return null;
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

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

router.post('/', auth, upload.single('attachment'), (req, res) => {
  const { worker_id, amount, date, notes } = req.body;
  const attachment = toBase64(req.file);
  const result = runQuery('INSERT INTO advances (worker_id, amount, date, notes, attachment, given_by) VALUES (?, ?, ?, ?, ?, ?)', [worker_id, amount, date, notes, attachment, req.user.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('advance:added', { id: result.lastInsertRowid, worker_id, amount });
  res.json({ id: result.lastInsertRowid, message: 'Advance recorded' });
});

router.delete('/:id', auth, (req, res) => {
  runQuery('DELETE FROM advances WHERE id = ?', [req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('advance:deleted', { id: req.params.id });
  res.json({ message: 'Advance deleted' });
});

module.exports = router;
