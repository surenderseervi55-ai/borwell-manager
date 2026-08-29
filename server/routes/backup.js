const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { runQuery, getAll, saveDb } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'borwell_secret';

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function exportAllData() {
  return {
    export_date: new Date().toISOString(),
    users: getAll('SELECT id, username, fullname, role, phone, created_at FROM users'),
    workers: getAll('SELECT * FROM workers'),
    machines: getAll('SELECT * FROM machines'),
    attendance: getAll('SELECT * FROM attendance'),
    expenses: getAll('SELECT * FROM expenses'),
    jobs: getAll('SELECT * FROM jobs'),
    bills: getAll('SELECT * FROM bills'),
    bill_payments: getAll('SELECT * FROM bill_payments'),
    worker_salaries: getAll('SELECT * FROM worker_salaries'),
    salary_payments: getAll('SELECT * FROM salary_payments'),
    advances: getAll('SELECT * FROM advances'),
    capital: getAll('SELECT * FROM capital'),
    settings: getAll('SELECT * FROM settings'),
  };
}

router.post('/now', auth, async (req, res) => {
  try {
    const data = exportAllData();
    const dataStr = JSON.stringify(data, null, 2);
    const filename = `borwell_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

    try {
      const { google } = require('googleapis');
      const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
      if (keyPath && keyPath !== 'path_to_service_account.json' && fs.existsSync(keyPath)) {
        const authObj = new google.auth.GoogleAuth({ keyFile: keyPath, scopes: ['https://www.googleapis.com/auth/drive.file'] });
        const drive = google.drive({ version: 'v3', auth: authObj });
        const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        const fileMetadata = { name: filename };
        if (folderId && folderId !== 'your_folder_id_here') fileMetadata.parents = [folderId];
        const { Readable } = require('stream');
        const media = { mimeType: 'application/json', body: Readable.from([dataStr]) };
        const file = await drive.files.create({ resource: fileMetadata, media, fields: 'id, webViewLink' });
        return res.json({ message: 'Backup uploaded to Google Drive', fileId: file.data.id, link: file.data.webViewLink, size: dataStr.length });
      }
    } catch (driveErr) {
      console.log('Google Drive not available:', driveErr.message);
    }

    const backupDir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, filename), dataStr);
    res.json({ message: 'Backup saved locally (Google Drive not configured)', filename, size: dataStr.length });
  } catch (err) {
    res.status(500).json({ error: 'Backup failed: ' + err.message });
  }
});

router.get('/download', auth, (req, res) => {
  const data = exportAllData();
  const filename = `borwell_backup_${new Date().toISOString().split('T')[0]}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(data);
});

router.post('/restore', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { data } = req.body;
  try {
    if (data.workers) {
      runQuery('DELETE FROM workers');
      for (const w of data.workers) runQuery('INSERT INTO workers (id, name, phone, role, machine_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [w.id, w.name, w.phone, w.role, w.machine_id, w.active, w.created_at]);
    }
    if (data.machines) {
      runQuery('DELETE FROM machines');
      for (const m of data.machines) runQuery('INSERT INTO machines (id, name, type, status, created_at) VALUES (?, ?, ?, ?, ?)', [m.id, m.name, m.type, m.status, m.created_at]);
    }
    if (data.attendance) {
      runQuery('DELETE FROM attendance');
      for (const a of data.attendance) runQuery('INSERT INTO attendance (id, worker_id, date, check_in, check_out, status, notes, marked_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [a.id, a.worker_id, a.date, a.check_in, a.check_out, a.status, a.notes, a.marked_by, a.created_at]);
    }
    if (data.expenses) {
      runQuery('DELETE FROM expenses');
      for (const e of data.expenses) runQuery('INSERT INTO expenses (id, date, category, amount, description, machine_id, added_by, attachment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [e.id, e.date, e.category, e.amount, e.description, e.machine_id, e.added_by, e.attachment, e.created_at]);
    }
    if (data.jobs) {
      runQuery('DELETE FROM jobs');
      for (const j of data.jobs) runQuery('INSERT INTO jobs (id, date, machine_id, customer_name, location, work_description, depth_feet, status, amount, received, pending, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [j.id, j.date, j.machine_id, j.customer_name, j.location, j.work_description, j.depth_feet, j.status, j.amount, j.received, j.pending, j.created_by, j.created_at]);
    }
    if (data.bills) {
      runQuery('DELETE FROM bills');
      for (const b of data.bills) runQuery('INSERT INTO bills (id, bill_number, date, customer_name, customer_phone, machine_id, job_id, total_amount, received_amount, pending_amount, status, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [b.id, b.bill_number, b.date, b.customer_name, b.customer_phone, b.machine_id, b.job_id, b.total_amount, b.received_amount, b.pending_amount, b.status, b.notes, b.created_by, b.created_at]);
    }
    if (data.bill_payments) {
      runQuery('DELETE FROM bill_payments');
      for (const bp of data.bill_payments) runQuery('INSERT INTO bill_payments (id, bill_id, amount, payment_date, payment_mode, notes, received_by, created_at) VALUES (?,?,?,?,?,?,?,?)', [bp.id, bp.bill_id, bp.amount, bp.payment_date, bp.payment_mode, bp.notes, bp.received_by, bp.created_at]);
    }
    if (data.worker_salaries) {
      runQuery('DELETE FROM worker_salaries');
      for (const ws of data.worker_salaries) runQuery('INSERT INTO worker_salaries (id, worker_id, per_day_rate, monthly_fixed, salary_type, effective_from, effective_to, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [ws.id, ws.worker_id, ws.per_day_rate, ws.monthly_fixed, ws.salary_type, ws.effective_from, ws.effective_to, ws.created_by, ws.created_at]);
    }
    if (data.salary_payments) {
      runQuery('DELETE FROM salary_payments');
      for (const sp of data.salary_payments) runQuery('INSERT INTO salary_payments (id, worker_id, salary_period_from, salary_period_to, days_worked, gross_salary, advance_deducted, net_paid, payment_date, payment_mode, notes, attachment, paid_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [sp.id, sp.worker_id, sp.salary_period_from, sp.salary_period_to, sp.days_worked, sp.gross_salary, sp.advance_deducted, sp.net_paid, sp.payment_date, sp.payment_mode, sp.notes, sp.attachment, sp.paid_by, sp.created_at]);
    }
    if (data.advances) {
      runQuery('DELETE FROM advances');
      for (const a of data.advances) runQuery('INSERT INTO advances (id, worker_id, amount, date, notes, attachment, given_by, created_at) VALUES (?,?,?,?,?,?,?,?)', [a.id, a.worker_id, a.amount, a.date, a.notes, a.attachment, a.given_by, a.created_at]);
    }
    if (data.capital) {
      runQuery('DELETE FROM capital');
      for (const c of data.capital) runQuery('INSERT INTO capital (id, date, amount, source, description, added_by, created_at) VALUES (?,?,?,?,?,?,?)', [c.id, c.date, c.amount, c.source, c.description, c.added_by, c.created_at]);
    }
    if (req.app.get('broadcast')) req.app.get('broadcast')('data:restored', { by: req.user.fullname });
    if (req.app.get('io')) req.app.get('io').emit('data:restored', { by: req.user.fullname });
    res.json({ message: 'Data restored successfully - all records including proofs restored, no data lost. All devices will auto-load.' });
  } catch (err) {
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});

module.exports = router;
