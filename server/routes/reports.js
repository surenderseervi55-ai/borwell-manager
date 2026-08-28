const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getAll, getOne } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'borwell_secret';

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { res.status(401).json({ error: 'Invalid token' }); }
}

router.get('/daily', auth, (req, res) => {
  const { date } = req.query;
  const d = date || new Date().toISOString().split('T')[0];

  const attendance = getAll('SELECT a.*, w.name as worker_name FROM attendance a JOIN workers w ON a.worker_id = w.id WHERE a.date = ?', [d]);
  const expenses = getAll('SELECT e.*, m.name as machine_name FROM expenses e LEFT JOIN machines m ON e.machine_id = m.id WHERE e.date = ?', [d]);
  const jobs = getAll('SELECT j.*, m.name as machine_name FROM jobs j JOIN machines m ON j.machine_id = m.id WHERE j.date = ?', [d]);

  const bills = getAll('SELECT b.*, m.name as machine_name FROM bills b LEFT JOIN machines m ON b.machine_id = m.id WHERE b.date = ?', [d]);
  const totalExpense = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalIncome = jobs.reduce((s, j) => s + (j.amount || 0), 0) + bills.reduce((s, b) => s + (b.received_amount || 0), 0);
  const totalPending = bills.reduce((s, b) => s + (b.pending_amount || 0), 0) + jobs.reduce((s, j) => s + (j.pending || 0), 0);
  const present = attendance.filter(a => a.status === 'present').length;
  const absent = attendance.filter(a => a.status === 'absent').length;

  res.json({ date: d, attendance: { total: attendance.length, present, absent, records: attendance }, expenses: { total: totalExpense, records: expenses }, jobs: { total: jobs.length, income: totalIncome, records: jobs }, bills: { total: bills.length, received: bills.reduce((s,b)=>s+(b.received_amount||0),0), pending: totalPending, records: bills }, profit: totalIncome - totalExpense, pending: totalPending });
});

router.get('/monthly', auth, (req, res) => {
  const { month, year } = req.query;
  const m = month || (new Date().getMonth() + 1);
  const y = year || new Date().getFullYear();
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const to = `${y}-${String(m).padStart(2, '0')}-31`;

  const expenses = getAll('SELECT category, SUM(amount) as total FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category', [from, to]);
  const jobs = getOne('SELECT SUM(amount) as total_income, COUNT(*) as total_jobs FROM jobs WHERE date BETWEEN ? AND ?', [from, to]);
  const attendance = getAll('SELECT status, COUNT(DISTINCT worker_id || date) as count FROM attendance WHERE date BETWEEN ? AND ? GROUP BY status', [from, to]);

  const totalExpense = expenses.reduce((s, e) => s + (e.total || 0), 0);
  const totalIncome = jobs?.total_income || 0;

  res.json({ month: m, year: y, expenses, totalExpense, totalIncome, profit: totalIncome - totalExpense, jobs_count: jobs?.total_jobs || 0, attendance });
});

module.exports = router;
