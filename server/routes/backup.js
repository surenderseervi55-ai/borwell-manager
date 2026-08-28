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
        const media = { mimeType: 'application/json', body: Buffer.from(dataStr) };
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
      for (const e of data.expenses) runQuery('INSERT INTO expenses (id, date, category, amount, description, machine_id, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [e.id, e.date, e.category, e.amount, e.description, e.machine_id, e.added_by, e.created_at]);
    }
    if (data.jobs) {
      runQuery('DELETE FROM jobs');
      for (const j of data.jobs) runQuery('INSERT INTO jobs (id, date, machine_id, customer_name, location, work_description, depth_feet, status, amount, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [j.id, j.date, j.machine_id, j.customer_name, j.location, j.work_description, j.depth_feet, j.status, j.amount, j.created_by, j.created_at]);
    }
    res.json({ message: 'Data restored successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});

module.exports = router;
