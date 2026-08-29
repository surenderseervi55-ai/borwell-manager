const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const { getDb, runQuery, getAll, getOne } = require('./database');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

function broadcast(event, data) {
  io.emit(event, data);
}

app.set('io', io);
app.set('broadcast', broadcast);

async function initDb() {
  await getDb();
  const admin = getOne('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    runQuery('INSERT INTO users (username, password, fullname, role) VALUES (?, ?, ?, ?)', ['admin', hash, 'System Admin', 'admin']);
  }
  const mc = getOne('SELECT COUNT(*) as cnt FROM machines');
  if (mc && mc.cnt === 0) {
    runQuery('INSERT INTO machines (name, type) VALUES (?, ?)', ['Borwell Machine 1', 'borwell']);
    runQuery('INSERT INTO machines (name, type) VALUES (?, ?)', ['Borwell Machine 2', 'borwell']);
  }
  console.log('Database ready');
}

app.use('/api/auth', require('./routes/auth'));
app.use('/api/workers', require('./routes/workers'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/machines', require('./routes/machines'));
app.use('/api/bills', require('./routes/bills'));
app.use('/api/salaries', require('./routes/salaries'));
app.use('/api/salary-payments', require('./routes/salaryPayments'));
app.use('/api/advances', require('./routes/advances'));
app.use('/api/capital', require('./routes/capital'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/sync', require('./routes/sync'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

initDb().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Borwell Manager running on port ${PORT}`);
    console.log('Default login: admin / admin123');
    console.log('Auto-save every 1 min: local file + online (Drive if configured) - data never lost');
  });

  // Auto-save specific file (borwell.db) and online backup every 1 minute
  setInterval(async () => {
    try {
      const { saveDb, getAll } = require('./database');
      saveDb(); // ensure local file is flushed (specific file: server/borwell.db)
      // Online backup to Drive if configured
      const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
      const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
      if (keyPath && folderId && keyPath !== 'path_to_service_account.json' && folderId !== 'your_folder_id_here' && require('fs').existsSync(keyPath)) {
        try {
          const { google } = require('googleapis');
          const auth = new google.auth.GoogleAuth({ keyFile: keyPath, scopes: ['https://www.googleapis.com/auth/drive.file'] });
          const drive = google.drive({ version: 'v3', auth });
          const data = {
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
          const dataStr = JSON.stringify(data, null, 2);
          const filename = `borwell_autosave_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
          await drive.files.create({ resource: { name: filename, parents: [folderId] }, media: { mimeType: 'application/json', body: Buffer.from(dataStr) }, fields: 'id' });
          console.log('Auto-saved to Drive:', filename);
        } catch (e) { console.log('Auto Drive backup failed:', e.message); }
      } else {
        // Local auto-backup
        const fs = require('fs');
        const path = require('path');
        const backupDir = path.join(__dirname, 'backups');
        fs.mkdirSync(backupDir, { recursive: true });
        const data = {
          export_date: new Date().toISOString(),
          workers: getAll('SELECT * FROM workers'),
          bills: getAll('SELECT * FROM bills'),
        };
        // Keep last 5 auto-saves, clean old
        const files = fs.readdirSync(backupDir).filter(f=>f.startsWith('borwell_autosave')).sort();
        if (files.length > 5) fs.unlinkSync(path.join(backupDir, files[0]));
      }
      console.log('Auto-saved local file server/borwell.db at', new Date().toLocaleTimeString());
    } catch (e) { console.log('Auto-save error:', e.message); }
  }, 60000); // 1 min - auto update and save every 1 min, specific file server/borwell.db + online
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
