// server.js
// LatinLoveMx PRO - Express + SQLite + Socket.io + JWT auth
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');

const JWT_SECRET = process.env.JWT_SECRET || 'latinlove-dev-secret';
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || './llmx.sqlite';

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ensure DB exists
const dbExists = fs.existsSync(DB_FILE);
const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  if (!dbExists) {
    // users, likes, matches, chats, messages
    db.run(`CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      password TEXT,
      age INTEGER,
      bio TEXT,
      img TEXT,
      lat REAL,
      lng REAL,
      created_at INTEGER
    )`);
    db.run(`CREATE TABLE likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id TEXT,
      to_id TEXT,
      ts INTEGER
    )`);
    db.run(`CREATE TABLE matches (
      id TEXT PRIMARY KEY,
      a TEXT,
      b TEXT,
      ts INTEGER
    )`);
    db.run(`CREATE TABLE chats (
      id TEXT PRIMARY KEY,
      match_id TEXT
    )`);
    db.run(`CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT,
      from_id TEXT,
      text TEXT,
      ts INTEGER
    )`);
    // seed a few demo profiles (no password)
    const seed = [
      { id:'u1', name:'Mariana', age:22, bio:'Amante de los viajes y el café.', img:'https://picsum.photos/seed/m1/600', lat:19.43, lng:-99.13 },
      { id:'u2', name:'Sofía', age:20, bio:'Me encantan los perros y el arte.', img:'https://picsum.photos/seed/m2/600', lat:19.45, lng:-99.12 },
      { id:'u3', name:'Valeria', age:23, bio:'Buscando algo bonito.', img:'https://picsum.photos/seed/m3/600', lat:19.40, lng:-99.14 }
    ];
    const stmt = db.prepare(`INSERT INTO users (id,name,email,password,age,bio,img,lat,lng,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const u of seed) {
      stmt.run(u.id, u.name, null, null, u.age, u.bio, u.img, u.lat, u.lng, Date.now());
    }
    stmt.finalize();
    console.log('DB created and seeded.');
  }
});

// ---------- helpers ----------
function generateId(prefix='id') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}
function authMiddleware(req, res, next){
  const auth = req.headers.authorization;
  if(!auth) return res.status(401).json({ error:'No token' });
  const token = auth.split(' ')[1];
  jwt.verify(token, JWT_SECRET, (err, payload)=>{
    if(err) return res.status(401).json({ error:'Invalid token' });
    req.user = payload;
    next();
  });
}

// ---------- auth endpoints ----------
app.post('/api/register', async (req, res) => {
  const { name, email, password, age, bio } = req.body;
  if(!email || !password || !name) return res.status(400).json({ error:'name,email,password required' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const id = generateId('u');
    db.run(`INSERT INTO users (id,name,email,password,age,bio,created_at) VALUES (?,?,?,?,?,?,?)`,
      [id,name,email,hashed,age||18,bio||'',Date.now()], function(err){
        if(err) return res.status(500).json({ error: err.message });
        const token = jwt.sign({ id, name, email }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, user:{ id, name, email, age, bio } });
      });
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if(!email || !password) return res.status(400).json({ error:'email,password required' });
  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err,row)=>{
    if(err) return res.status(500).json({ error: err.message });
    if(!row) return res.status(401).json({ error:'invalid' });
    const ok = await bcrypt.compare(password, row.password || '');
    if(!ok) return res.status(401).json({ error:'invalid' });
    const token = jwt.sign({ id: row.id, email: row.email, name: row.name }, JWT_SECRET, { expiresIn:'30d' });
    res.json({ token, user:{ id: row.id, name: row.name, email: row.email, age: row.age, bio: row.bio, img: row.img } });
  });
});

// ---------- public endpoints ----------
app.get('/api/profiles', (req, res) => {
  // returns all users except optionally ?exclude=meid
  const exclude = req.query.exclude;
  db.all(`SELECT id,name,age,bio,img,lat,lng FROM users ${exclude ? 'WHERE id != ?' : ''} LIMIT 100`,
    exclude ? [exclude] : [], (err, rows) => {
      if(err) return res.status(500).json({ error:err.message });
      res.json(rows);
    });
});

// like endpoint (requires auth)
app.post('/api/like', authMiddleware, (req,res) => {
  const from = req.user.id;
  const { to } = req.body;
  if(!to) return res.status(400).json({ error:'to required' });
  const ts = Date.now();
  db.run(`INSERT INTO likes (from_id,to_id,ts) VALUES (?,?,?)`, [from,to,ts], function(err){
    if(err) return res.status(500).json({ error:err.message });
    // check inverse
    db.get(`SELECT * FROM likes WHERE from_id = ? AND to_id = ?`, [to, from], (err,row)=>{
      if(err) return res.status(500).json({ error:err.message });
      if(row){
        // create match (if not exists)
        const mid = 'm'+Date.now().toString(36);
        db.run(`INSERT OR IGNORE INTO matches (id,a,b,ts) VALUES (?,?,?,?)`, [mid, from, to, ts]);
        db.run(`INSERT OR IGNORE INTO chats (id,match_id) VALUES (?,?)`, [mid, mid]);
        // inform clients (optional)
        io.to('user:'+to).emit('matched', { with: from, matchId: mid });
        return res.json({ ok:true, matched:true, matchId: mid });
      } else {
        return res.json({ ok:true, matched:false });
      }
    });
  });
});

// get matches for user
app.get('/api/matches', authMiddleware, (req,res) => {
  const uid = req.user.id;
  db.all(`SELECT * FROM matches WHERE a = ? OR b = ?`, [uid, uid], (err, rows)=>{
    if(err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// get chats metadata (for user's matches)
app.get('/api/chats', authMiddleware, (req,res)=>{
  const uid = req.user.id;
  db.all(`SELECT m.id as matchId, m.a, m.b, c.id as chatId
          FROM matches m LEFT JOIN chats c ON c.id = m.id
          WHERE m.a = ? OR m.b = ?`, [uid, uid], (err, rows)=>{
    if(err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// messages for chat
app.get('/api/messages/:chatId', authMiddleware, (req,res)=>{
  const chatId = req.params.chatId;
  db.all(`SELECT id,from_id as fromId,text,ts FROM messages WHERE chat_id = ? ORDER BY ts ASC`, [chatId], (err, rows)=>{
    if(err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// post message (fallback if not using socket)
app.post('/api/messages/:chatId', authMiddleware, (req,res)=>{
  const chatId = req.params.chatId;
  const from = req.user.id;
  const { text } = req.body;
  const ts = Date.now();
  db.run(`INSERT INTO messages (chat_id,from_id,text,ts) VALUES (?,?,?,?)`, [chatId, from, text, ts], function(err){
    if(err) return res.status(500).json({ error: err.message });
    // broadcast to socket room
    io.to('chat:'+chatId).emit('message', { chatId, from, text, ts });
    res.json({ ok:true, id: this.lastID });
  });
});

// serve frontend static files (optional)
// app.use(express.static(path.join(__dirname, 'public')));

// ---------- SOCKET.IO ----------
// clients must send token in handshake query: ?token=...
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if(!token) return next(new Error('auth error'));
  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if(err) return next(new Error('auth error'));
    socket.user = payload;
    next();
  });
});

io.on('connection', (socket) => {
  const uid = socket.user.id;
  // join a private room to receive notifications
  socket.join('user:'+uid);
  console.log('socket connected for', uid);

  // client can join chat rooms
  socket.on('joinChat', (chatId) => {
    socket.join('chat:'+chatId);
  });

  socket.on('leaveChat', (chatId) => {
    socket.leave('chat:'+chatId);
  });

  socket.on('sendMessage', (payload) => {
    // { chatId, text }
    const { chatId, text } = payload;
    if(!chatId || !text) return;
    const from = uid;
    const ts = Date.now();
    db.run(`INSERT INTO messages (chat_id,from_id,text,ts) VALUES (?,?,?,?)`, [chatId, from, text, ts], function(err){
      if(err){
        console.error(err);
        return;
      }
      // broadcast to room
      io.to('chat:'+chatId).emit('message', { chatId, from, text, ts });
    });
  });

  socket.on('disconnect', ()=> {
    console.log('socket disconnect', uid);
  });
});

// start server
server.listen(PORT, ()=> console.log(`Server running on port ${PORT}`));
