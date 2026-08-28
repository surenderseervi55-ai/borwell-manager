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
  let query = 'SELECT sp.*, w.name as worker_name, u.fullname as paid_by_name FROM salary_payments sp JOIN workers w ON sp.worker_id = w.id LEFT JOIN users u ON sp.paid_by = u.id WHERE 1=1';
  const params = [];
  if (worker_id) { query += ' AND sp.worker_id = ?'; params.push(worker_id); }
  if (from && to) { query += ' AND sp.payment_date BETWEEN ? AND ?'; params.push(from, to); }
  query += ' ORDER BY sp.salary_period_from DESC';
  res.json(getAll(query, params));
});

router.get('/summary', auth, (req, res) => {
  const { from, to } = req.query;
  const f = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const t = to || new Date().toISOString().split('T')[0];
  const workers = getAll(`SELECT w.id, w.name, w.phone,
    (SELECT per_day_rate FROM worker_salaries WHERE worker_id = w.id AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1) as per_day_rate,
    (SELECT salary_type FROM worker_salaries WHERE worker_id = w.id AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1) as salary_type,
    (SELECT monthly_fixed FROM worker_salaries WHERE worker_id = w.id AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1) as monthly_fixed
    FROM workers w WHERE w.active = 1`, [t, t, t]);
  
  const attendance = getAll(`SELECT worker_id, SUM(CASE WHEN status='present' THEN 1 WHEN status='half_day' THEN 0.5 ELSE 0 END) as days_present FROM attendance WHERE date BETWEEN ? AND ? GROUP BY worker_id`, [f, t]);
  const payments = getAll('SELECT worker_id, SUM(net_paid) as total_paid, SUM(advance_deducted) as total_advance FROM salary_payments WHERE payment_date BETWEEN ? AND ? GROUP BY worker_id', [f, t]);
  
  const attMap = Object.fromEntries(attendance.map(a => [a.worker_id, a.days_present]));
  const payMap = Object.fromEntries(payments.map(p => [p.worker_id, { paid: p.total_paid, advance: p.total_advance }]));
  
  const summary = workers.map(w => {
    const days = attMap[w.id] || 0;
    const rate = w.per_day_rate || 0;
    const gross = w.salary_type === 'monthly' ? (w.monthly_fixed || 0) : (days * rate);
    const paid = (payMap[w.id]?.paid || 0) + (payMap[w.id]?.advance || 0);
    const pending = gross - paid;
    return { ...w, days_worked: days, gross_salary: gross, paid, pending };
  });
  
  res.json({ period: { from: f, to: t }, workers: summary });
});

router.post('/', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { worker_id, salary_period_from, salary_period_to, days_worked, gross_salary, advance_deducted, net_paid, payment_date, payment_mode, notes } = req.body;
  const result = runQuery('INSERT INTO salary_payments (worker_id, salary_period_from, salary_period_to, days_worked, gross_salary, advance_deducted, net_paid, payment_date, payment_mode, notes, paid_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [worker_id, salary_period_from, salary_period_to, days_worked, gross_salary, advance_deducted || 0, net_paid, payment_date, payment_mode || 'cash', notes, req.user.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('salary:payment:added', { id: result.lastInsertRowid, worker_id });
  res.json({ id: result.lastInsertRowid, message: 'Salary payment recorded' });
});

router.put('/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { worker_id, salary_period_from, salary_period_to, days_worked, gross_salary, advance_deducted, net_paid, payment_date, payment_mode, notes } = req.body;
  runQuery('UPDATE salary_payments SET worker_id=?, salary_period_from=?, salary_period_to=?, days_worked=?, gross_salary=?, advance_deducted=?, net_paid=?, payment_date=?, payment_mode=?, notes=? WHERE id=?', [worker_id, salary_period_from, salary_period_to, days_worked, gross_salary, advance_deducted, net_paid, payment_date, payment_mode, notes, req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('salary:payment:updated', { id: req.params.id });
  res.json({ message: 'Salary payment updated' });
});

router.delete('/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  runQuery('DELETE FROM salary_payments WHERE id = ?', [req.params.id]);
  if (req.app.get('broadcast')) req.app.get('broadcast')('salary:payment:deleted', { id: req.params.id });
  res.json({ message: 'Salary payment deleted' });
});

module.exports = router;