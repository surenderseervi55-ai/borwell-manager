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
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
