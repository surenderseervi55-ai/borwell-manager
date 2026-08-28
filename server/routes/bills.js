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

function generateBillNumber() {
  const date = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `BILL-${date}-${random}`;
}

router.get('/', auth, (req, res) => {
  const { status, from, to, customer_name } = req.query;
  let query = 'SELECT b.*, m.name as machine_name, u.fullname as created_by_name FROM bills b LEFT JOIN machines m ON b.machine_id = m.id LEFT JOIN users u ON b.created_by = u.id WHERE 1=1';
  const params = [];
  if (status) { query += ' AND b.status = ?'; params.push(status); }
  if (customer_name) { query += ' AND b.customer_name LIKE ?'; params.push(`%${customer_name}%`); }
  if (from && to) { query += ' AND b.date BETWEEN ? AND ?'; params.push(from, to); }
  query += ' ORDER BY b.date DESC, b.id DESC';
  res.json(getAll(query, params));
});

router.get('/:id', auth, (req, res) => {
  const bill = getOne('SELECT b.*, m.name as machine_name FROM bills b LEFT JOIN machines m ON b.machine_id = m.id WHERE b.id = ?', [req.params.id]);
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  const payments = getAll('SELECT bp.*, u.fullname as received_by_name FROM bill_payments bp LEFT JOIN users u ON bp.received_by = u.id WHERE bp.bill_id = ? ORDER BY bp.payment_date DESC', [req.params.id]);
  res.json({ bill, payments });
});

router.post('/', auth, (req, res) => {
  const { date, customer_name, customer_phone, machine_id, job_id, total_amount, received_amount, notes } = req.body;
  const billNumber = generateBillNumber();
  const rec = received_amount || 0;
  const pending = (total_amount || 0) - rec;
  const status = pending <= 0 ? 'paid' : (rec > 0 ? 'partial' : 'pending');
  const result = runQuery('INSERT INTO bills (bill_number, date, customer_name, customer_phone, machine_id, job_id, total_amount, received_amount, pending_amount, status, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [billNumber, date, customer_name, customer_phone, machine_id, job_id, total_amount, rec, pending, status, notes, req.user.id]);
  if (rec > 0) {
    runQuery('INSERT INTO bill_payments (bill_id, amount, payment_date, payment_mode, notes, received_by) VALUES (?, ?, ?, ?, ?, ?)', [result.lastInsertRowid, rec, date, 'cash', 'Initial payment', req.user.id]);
  }
  if (req.app.get('broadcast')) req.app.get('broadcast')('bill:added', { id: result.lastInsertRowid, billNumber, customer_name, total_amount });
  res.json({ id: result.lastInsertRowid, billNumber, message: 'Bill created' });
});

router.put('/:id', auth, (req, res) => {
  const { date, customer_name, customer_phone, machine_id, job_id, total_amount, received_amount, notes, status } = req.body;
  const rec = received_amount || 0;
  const pending = (total_amount || 0) - rec;
  const st = status || (pending <= 0 ? 'paid' : (rec > 0 ? 'partial' : 'pending'));
  runQuery('UPDATE bills SET date=?, customer_name=?, customer_phone=?, machine_id=?, job_id=?, total_amount=?, received_amount=?, pending_amount=?, status=?, notes=? WHERE id=?', [date, customer_name, customer_phone, machine_id, job_id, total_amount, rec, pending, st, notes, req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('bill:updated', { id: req.params.id });
  res.json({ message: 'Bill updated' });
});

router.post('/:id/payment', auth, (req, res) => {
  const { amount, payment_date, payment_mode, notes } = req.body;
  const bill = getOne('SELECT * FROM bills WHERE id = ?', [req.params.id]);
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  const newReceived = (bill.received_amount || 0) + (amount || 0);
  const newPending = (bill.total_amount || 0) - newReceived;
  const newStatus = newPending <= 0 ? 'paid' : (newReceived > 0 ? 'partial' : 'pending');
  runQuery('INSERT INTO bill_payments (bill_id, amount, payment_date, payment_mode, notes, received_by) VALUES (?, ?, ?, ?, ?, ?)', [req.params.id, amount, payment_date, payment_mode || 'cash', notes, req.user.id]);
  runQuery('UPDATE bills SET received_amount=?, pending_amount=?, status=? WHERE id=?', [newReceived, newPending, newStatus, req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('bill:payment', { billId: req.params.id, amount, newStatus });
  res.json({ message: 'Payment recorded', newReceived, newPending, newStatus });
});

router.delete('/:id', auth, (req, res) => {
  runQuery('DELETE FROM bill_payments WHERE bill_id = ?', [req.params.id]);
  runQuery('DELETE FROM bills WHERE id = ?', [req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('bill:deleted', { id: req.params.id });
  res.json({ message: 'Bill deleted' });
});

module.exports = router;