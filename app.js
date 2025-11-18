// app.js - front
// Ajusta la URL de API si usas otro host
const API = window.location.origin; // si backend en mismo host + puerto: usa full URL, ej: 'https://mi-backend.com'
let token = localStorage.getItem('llmx_token') || null;
let me = JSON.parse(localStorage.getItem('llmx_me') || 'null');
let socket = null;

// DOM refs
const views = {
  discover: document.getElementById('discover'),
  matches: document.getElementById('matches'),
  chat: document.getElementById('chat'),
  profile: document.getElementById('profile')
};
const deck = document.getElementById('deck');
const matchesList = document.getElementById('matchesList');
const convoList = document.getElementById('convoList');
const messagesEl = document.getElementById('messages');
const chatHeader = document.getElementById('chatHeader');
const msgInput = document.getElementById('msgInput');
const btnSend = document.getElementById('btnSend');

document.getElementById('navDiscover').addEventListener('click', ()=> show('discover'));
document.getElementById('navMatches').addEventListener('click', ()=> { renderMatches(); show('matches'); });
document.getElementById('navChat').addEventListener('click', ()=> { renderConversations(); show('chat'); });
document.getElementById('navProfile').addEventListener('click', ()=> show('profile'));

// profile buttons
document.getElementById('btnSaveProfile').addEventListener('click', registerOrSave);
document.getElementById('btnLogin').addEventListener('click', login);
document.getElementById('btnLogout').addEventListener('click', logout);

function show(name){
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name].classList.add('active');
  document.querySelectorAll('nav .nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('nav'+name.charAt(0).toUpperCase()+name.slice(1)).classList.add('active');
}

async function apiFetch(path, opts = {}) {
  const headers = opts.headers || {};
  headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  opts.headers = headers;
  const res = await fetch(API + path, opts);
  if (res.status === 401) {
    logout();
    throw new Error('Unauthorized');
  }
  return res.json();
}

// init
(async function init(){
  if(token) connectSocket();
  renderDeck();
  renderProfileValues();
})();

// ---------- profiles / deck ----------
async function renderDeck(){
  deck.innerHTML = '<div class="card center">Cargando...</div>';
  try {
    // exclude me
    const q = me?.id ? `?exclude=${me.id}` : '';
    const profiles = await apiFetch('/api/profiles' + q);
    if(!profiles || profiles.length===0) {
      deck.innerHTML = '<div class="card center">No hay perfiles</div>';
      return;
    }
    // show first profile
    const p = profiles[0];
    deck.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img src="${p.img}" />
      <div class="info">
        <div style="display:flex;justify-content:space-between">
          <div><div style="font-weight:800">${p.name}</div><div style="color:#9aa4b2">${p.bio}</div></div>
        </div>
      </div>
      <div class="controls center">
        <button class="btn-no" onclick='onDislike("${p.id}")'>No</button>
        <button class="btn-like" onclick='onLike("${p.id}")'>Sí</button>
      </div>
    `;
    deck.appendChild(card);
  } catch(e){
    deck.innerHTML = '<div class="card center">Error cargando perfiles</div>';
    console.error(e);
  }
}

async function onLike(toId){
  if(!token) return alert('Inicia sesión para dar like');
  try {
    const res = await apiFetch('/api/like', { method:'POST', body: JSON.stringify({ to: toId }) });
    if(res.matched) alert('¡Es match! 🎉');
    // refresh deck
    await renderDeck();
    renderMatches();
  } catch(e){ console.error(e); alert('Error like'); }
}

function onDislike(toId){
  // simple local action: just fetch next set (the backend could store dislikes if desired)
  renderDeck();
}

// ---------- auth / profile ----------
async function registerOrSave(){
  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  const age = Number(document.getElementById('age').value) || 18;
  const bio = document.getElementById('bio').value.trim();
  if(!email || !password || !name) return alert('Nombre, email y contraseña requeridos');
  try {
    const res = await fetch(API + '/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, email, password, age, bio })});
    const json = await res.json();
    if(json.token){
      token = json.token;
      me = json.user;
      localStorage.setItem('llmx_token', token);
      localStorage.setItem('llmx_me', JSON.stringify(me));
      connectSocket();
      alert('Registrado y conectado');
      renderDeck();
    } else {
      alert('Error registro: ' + (json.error || JSON.stringify(json)));
    }
  } catch(e){ console.error(e); alert('Error registro'); }
}

async function login(){
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  if(!email || !password) return alert('Email y password');
  try {
    const res = await fetch(API + '/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password })});
    const json = await res.json();
    if(json.token){
      token = json.token;
      me = json.user;
      localStorage.setItem('llmx_token', token);
      localStorage.setItem('llmx_me', JSON.stringify(me));
      connectSocket();
      alert('Sesión iniciada');
      renderDeck();
    } else {
      alert('Error login: '+(json.error||JSON.stringify(json)));
    }
  } catch(e){ console.error(e); alert('Error login'); }
}

function logout(){
  token = null; me = null;
  localStorage.removeItem('llmx_token'); localStorage.removeItem('llmx_me');
  if(socket){ socket.disconnect(); socket = null; }
  alert('Cerraste sesión');
  renderDeck();
  renderProfileValues();
}

// populate profile fields if user exists
function renderProfileValues(){
  if(!me) {
    document.getElementById('myAvatar').src = '';
    return;
  }
  document.getElementById('name').value = me.name || '';
  document.getElementById('email').value = me.email || '';
  document.getElementById('age').value = me.age || '';
  document.getElementById('bio').value = me.bio || '';
  if(me.img) document.getElementById('myAvatar').src = me.img;
}

// ---------- matches / chats ----------
async function renderMatches(){
  if(!token) { matchesList.innerHTML = '<div class="card">Inicia sesión</div>'; return; }
  try {
    const rows = await apiFetch('/api/matches');
    matchesList.innerHTML = '';
    for(const m of rows){
      const otherId = (m.a === (me?.id) ? m.b : m.a);
      // fetch other profile quickly
      const profiles = await apiFetch('/api/profiles');
      const other = profiles.find(p => p.id === otherId) || { name: otherId, img:'' };
      const el = document.createElement('div');
      el.className = 'match-item';
      el.innerHTML = `<img class="avatar" src="${other.img}" /><div style="flex:1"><div style="font-weight:700">${other.name}</div><div class="small">${other.bio}</div></div><button onclick="openChat('${m.id}')">Chat</button>`;
      matchesList.appendChild(el);
    }
  } catch(e){ console.error(e); matchesList.innerHTML = '<div class="card">Error</div>'; }
}

// conversations list (based on server chats)
async function renderConversations(){
  if(!token){ convoList.innerHTML = '<div class="card">Inicia sesión</div>'; return; }
  try {
    const rows = await apiFetch('/api/chats');
    convoList.innerHTML = '';
    for(const c of rows){
      const otherId = c.a === me.id ? c.b : c.a;
      const profiles = await apiFetch('/api/profiles');
      const other = profiles.find(p => p.id === otherId) || { name: otherId, img:'' };
      const el = document.createElement('div');
      el.className = 'convo-item';
      el.innerHTML = `<img class="avatar" src="${other.img}" /><div style="flex:1"><div style="font-weight:700">${other.name}</div></div>`;
      el.addEventListener('click', () => openChat(c.matchId));
      convoList.appendChild(el);
    }
  } catch(e){ console.error(e); convoList.innerHTML = '<div class="card">Error</div>'; }
}

let activeChatId = null;
async function openChat(matchId){
  activeChatId = matchId;
  // join socket room
  if(socket) socket.emit('joinChat', matchId);
  // get messages
  const msgs = await apiFetch('/api/messages/' + matchId);
  messagesEl.innerHTML = '';
  for(const m of msgs){
    const d = document.createElement('div');
    d.className = 'msg ' + (m.fromId === me.id ? 'me' : 'them');
    d.innerText = m.text;
    messagesEl.appendChild(d);
  }
  chatHeader.innerText = 'Chat';
  show('chat');
  // wire send button
  btnSend.onclick = () => {
    const text = msgInput.value.trim();
    if(!text) return;
    // prefer socket
    if(socket){
      socket.emit('sendMessage', { chatId: activeChatId, text });
    } else {
      // fallback HTTP
      apiFetch('/api/messages/' + activeChatId, { method:'POST', body: JSON.stringify({ text }) });
    }
    msgInput.value = '';
  };
}

// ---------- sockets ----------
function connectSocket(){
  if(!token) return;
  // connect with token for auth
  socket = io(API, { auth: { token } });
  socket.on('connect', () => {
    console.log('socket connected', socket.id);
  });
  socket.on('message', (m) => {
    // if message for active chat -> append
    if(m.chatId === activeChatId){
      const d = document.createElement('div');
      d.className = 'msg ' + (m.from === me.id ? 'me' : 'them');
      d.innerText = m.text;
      messagesEl.appendChild(d);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else {
      // show a simple notification (could be improved)
      console.log('mensaje recibido en chat', m.chatId);
    }
  });
  socket.on('matched', (payload) => {
    // payload { with: userId, matchId }
    alert('¡Tienes un nuevo match!');
    renderMatches();
  });
  socket.on('disconnect', ()=> console.log('socket disconnected'));
}
