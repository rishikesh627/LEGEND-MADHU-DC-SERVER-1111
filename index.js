global.WebSocket = require('ws');

const express = require('express');
const { MessengerClient, Platform, CookieManager } = require('messagix-js');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = './tasks.json';

// ============ SECURITY CONFIG ============
const ADMIN_KEY = 'Rishi&bots@2026#Panel';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'CookieEncrypt_998877_Rishi_FallbackKey';

// Server ka naam — env se ya fixed name se
const SERVER_NAME = process.env.SERVER_NAME || `rishi24/7 bots`;

if (!ADMIN_KEY || ADMIN_KEY.length < 16) {
    console.error('FATAL: ADMIN_KEY too short (min 16 chars).');
    process.exit(1);
}
if (!COOKIE_SECRET || COOKIE_SECRET.length < 16) {
    console.error('FATAL: COOKIE_SECRET too short (min 16 chars).');
    process.exit(1);
}

const AES_KEY = crypto.createHash('sha256').update(COOKIE_SECRET).digest();

function enc(str) {
    if (str === '' || str == null) return '';
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', AES_KEY, iv);
    const e = Buffer.concat([c.update(String(str), 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), e]).toString('base64');
}
function dec(b64) {
    if (!b64) return '';
    try {
        const buf = Buffer.from(b64, 'base64');
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const e = buf.subarray(28);
        const d = crypto.createDecipheriv('aes-256-gcm', AES_KEY, iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(e), d.final()]).toString('utf8');
    } catch (e) {
        console.error('[DEC ERROR]', e.message);
        return '';
    }
}

// ============ CONFIG LIMITS ============
const MAX_TASKS = 20;
const MIN_DELAY = 2;
const MAX_DELAY = 3600;
const SEND_TIMEOUT_MS = 30000;
const CONNECT_TIMEOUT_MS = 25000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

process.on('uncaughtException', (err) => {
    console.error('[ANTI-CRASH] Uncaught:', err.stack || err.message);
});
process.on('unhandledRejection', (r) => {
    console.error('[ANTI-CRASH] Rejection:', r?.stack || r);
});

const activeTasks = new Map();

// ============ THROTTLED SAVE ============
let saveTimer = null;

function serializeTask(t) {
    return {
        cookies: enc(t.cookies),
        backupCookies: enc(t.backupCookies || ''),
        threadId: t.threadId,
        hatersName: t.hatersName,
        messages: t.messages,
        delaySec: t.delaySec,
        status: t.status,
        startTime: t.startTime,
        logs: t.logs.slice(-60),
        activeCookieSource: t.activeCookieSource || 'primary',
        taskName: t.taskName || ''
    };
}

function saveTasks() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        const out = {};
        for (const [id, t] of activeTasks.entries()) out[id] = serializeTask(t);
        try { fs.writeFileSync(DB_FILE, JSON.stringify(out, null, 2)); }
        catch (e) { console.error('[SAVE ERROR]', e.message); }
    }, 2000);
}

function saveTasksNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const out = {};
    for (const [id, t] of activeTasks.entries()) out[id] = serializeTask(t);
    try { fs.writeFileSync(DB_FILE, JSON.stringify(out, null, 2)); }
    catch (e) { console.error('[SAVE ERROR]', e.message); }
}

function getUptimeString(startTime) {
    const diff = Date.now() - startTime;
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${d}D ${h}H ${m}M`;
}

function pushLog(task, msg) {
    task.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (task.logs.length > 60) task.logs.shift();
}

// ============ LOAD TASKS ON BOOT ============
function loadTasks() {
    if (!fs.existsSync(DB_FILE)) return;
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        for (const [taskId, taskData] of Object.entries(data)) {
            if (taskData.status === 'running') {
                const cookies = dec(taskData.cookies);
                const backupCookies = dec(taskData.backupCookies || '');
                if (!cookies) {
                    console.warn(`[LOAD SKIP] ${taskId}: cookie decrypt failed`);
                    continue;
                }
                const task = {
                    ...taskData,
                    cookies,
                    backupCookies,
                    taskName: taskData.taskName || taskId,
                    forceReconnect: false,
                    isRunning: false
                };
                activeTasks.set(taskId, task);
                console.log(`[AUTO-DEPLOY] Restoring: ${taskId} (${task.taskName})`);
                runPersistentTask(taskId);
            }
        }
    } catch (e) {
        console.error("[LOAD ERROR]", e.stack || e.message);
    }
}

// ============ AUTH MIDDLEWARE ============
function safeEqual(a, b) {
    const ba = Buffer.from(String(a || ''));
    const bb = Buffer.from(String(b || ''));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

app.use((req, res, next) => {
    if (req.path === '/' || req.path === '/ping') return next();
    if (req.method === 'HEAD') return next();

    const key = req.headers['x-admin-key'] || req.query.key || '';
    if (!safeEqual(key, ADMIN_KEY)) {
        return res.status(401).json({ success: false, error: 'Unauthorized. Admin key required.' });
    }
    next();
});

// ============ PUBLIC ROUTES ============
app.head('/', (req, res) => res.status(200).end());
app.get('/ping', (req, res) => res.send('Pong'));

// ============ SERVER INFO ============
app.get('/server-info', (req, res) => {
    res.json({
        success: true,
        serverName: SERVER_NAME,
        hostname: os.hostname(),
        uptime: getUptimeString(Date.now() - process.uptime() * 1000),
        taskCount: activeTasks.size
    });
});

// ============ LIST ALL TASKS ============
app.get('/tasks', (req, res) => {
    const list = [];
    for (const [id, t] of activeTasks.entries()) {
        list.push({
            taskId: id,
            taskName: t.taskName || id,
            status: t.status,
            uptime: getUptimeString(t.startTime),
            activeCookieSource: t.activeCookieSource || 'primary',
            threadId: t.threadId,
            serverName: SERVER_NAME
        });
    }
    res.json({ success: true, serverName: SERVER_NAME, tasks: list });
});

// ============ HTML UI ============
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="hi"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>⚡ rishi24/7 bots ⚡</title>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{
  font-family:'Rajdhani',sans-serif;
  background-image: linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url('https://i.ibb.co/DH6kBWh9/images.jpg');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-attachment: fixed;
  background-color: #282a36;
  color:#f8f8f2;
  padding:20px;margin:0;min-height:100vh;
}
.c{max-width:820px;margin:auto;background:linear-gradient(160deg, rgba(40,42,54,.94), rgba(30,32,42,.97));padding:30px;border-radius:20px;border:1.5px solid rgba(189,147,249,.5);box-shadow:0 0 25px rgba(189,147,249,.3),0 0 60px rgba(255,121,198,.15),inset 0 0 40px rgba(139,233,253,.08);}
h2{text-align:center;margin:0 0 10px;font-family:'Orbitron',sans-serif;font-weight:900;font-size:22px;letter-spacing:1px;color:#bd93f9;text-shadow:0 0 8px rgba(189,147,249,.9),0 0 20px rgba(189,147,249,.6);}
.b{text-align:center;background:linear-gradient(135deg,#ff79c6,#bd93f9,#8be9fd);color:#fff;display:block;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:700;margin:0 auto 22px;width:fit-content;font-family:'Orbitron',sans-serif;letter-spacing:1px;box-shadow:0 0 18px rgba(255,121,198,.6);}
label{font-weight:600;margin-top:16px;display:block;font-size:14px;color:#8be9fd;letter-spacing:.4px;}
input,textarea{width:100%;padding:12px;margin-top:6px;border-radius:10px;border:1.5px solid rgba(189,147,249,.35);background:rgba(30,32,42,.85);color:#f8f8f2;font-family:'Rajdhani',sans-serif;font-size:15px;outline:none;transition:.25s;}
input:focus,textarea:focus{border-color:#bd93f9;box-shadow:0 0 12px rgba(189,147,249,.6);}
textarea{height:80px;resize:vertical}
.fb{margin-top:6px;background:rgba(255,121,198,.08);border:1.5px dashed #ff79c6;padding:12px;border-radius:10px;text-align:center;cursor:pointer;}
.fb input{display:none}
.fl{color:#ff79c6;font-weight:600;font-size:13px;cursor:pointer}
button{padding:14px;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:15px;width:100%;margin-top:15px;color:#fff;font-family:'Orbitron',sans-serif;letter-spacing:1px;}
button:hover{filter:brightness(1.15)}
.bs{background:linear-gradient(135deg,#8be9fd,#6272a4,#bd93f9);box-shadow:0 0 20px rgba(189,147,249,.55)}
.bc{background:linear-gradient(135deg,#8be9fd,#6272a4)}
.bt{background:linear-gradient(135deg,#ff79c6,#c2003f)}
.con{background:#1e202a;border:1px solid rgba(139,233,253,.35);color:#50fa7b;padding:15px;border-radius:10px;height:220px;overflow-y:auto;font-family:'Courier New',monospace;font-size:12.5px;margin-top:10px;line-height:1.5;white-space:pre-wrap;word-break:break-word;}
.tb{margin-top:30px;border-top:1.5px dashed rgba(189,147,249,.35);padding:18px;background:rgba(40,42,54,.6);border-radius:15px;}
.tb h3{font-family:'Orbitron',sans-serif;color:#ff79c6;margin:0 0 8px;font-size:16px;}
.sb{display:inline-block;padding:6px 14px;border-radius:12px;font-size:12.5px;font-weight:700;background:rgba(189,147,249,.12);color:#bd93f9;border:1px solid rgba(189,147,249,.5);margin-top:12px;font-family:'Orbitron',sans-serif;}
.key-bar{background:rgba(255,121,198,.1);border:1.5px solid #ff79c6;padding:10px;border-radius:10px;margin-bottom:15px;font-size:13px;color:#ff79c6;text-align:center;}
.server-badge{display:inline-block;padding:4px 12px;background:rgba(189,147,249,.15);border:1px solid #bd93f9;border-radius:8px;font-size:12px;color:#bd93f9;margin-bottom:15px;font-family:'Orbitron',sans-serif;}

/* ============ TABS ============ */
.tabs-header{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;border-bottom:1.5px solid rgba(189,147,249,.2);padding-bottom:12px;}
.tab-btn{
  display:flex;align-items:center;gap:8px;
  padding:8px 14px;background:rgba(98,114,164,.4);
  border:1px solid rgba(189,147,249,.3);border-radius:10px 10px 0 0;
  color:#8be9fd;cursor:pointer;font-family:'Rajdhani',sans-serif;
  font-weight:600;font-size:13px;transition:.2s;max-width:280px;
}
.tab-btn:hover{background:rgba(189,147,249,.35);color:#fff}
.tab-btn.active{
  background:linear-gradient(135deg,rgba(139,233,253,.3),rgba(189,147,249,.4));
  border-color:#bd93f9;color:#fff;
  box-shadow:0 0 15px rgba(189,147,249,.5);
}
.tab-btn .tab-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px;}
.tab-btn .close-x{
  display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;border-radius:50%;
  background:rgba(255,121,198,.4);color:#fff;font-size:12px;
  line-height:1;font-weight:900;
}
.tab-btn .close-x:hover{background:#ff79c6;transform:scale(1.15)}
.tab-btn .status-dot{width:8px;height:8px;border-radius:50%;background:#50fa7b;box-shadow:0 0 6px #50fa7b;}
.tab-btn .status-dot.waiting{background:#f1fa8c;box-shadow:0 0 6px #f1fa8c;}
.tab-btn .status-dot.backup{background:#ffb86c;box-shadow:0 0 6px #ffb86c;}

.tab-panel{display:none;}
.tab-panel.active{display:block;}
.tab-meta{font-size:12.5px;color:#8be9fd;margin-bottom:8px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;}
.tab-meta .pill{background:rgba(189,147,249,.1);padding:3px 10px;border-radius:8px;border:1px solid rgba(189,147,249,.3);}
.tab-meta .pill.server{color:#ff79c6;border-color:rgba(255,121,198,.5);background:rgba(255,121,198,.1);}

.empty-state{text-align:center;padding:30px;color:#6272a4;font-size:14px;}
.no-tasks-msg{padding:20px;text-align:center;color:#8be9fd;font-size:14px;background:rgba(189,147,249,.05);border-radius:10px;border:1px dashed rgba(189,147,249,.3);}
</style></head><body><div class="c">
<h2>⚡ rishi24/7 bots ⚡</h2>
<span class="b">DEVELOPER: THE LEGEND BOY RISHI</span>
<div style="text-align:center"><span class="server-badge" id="serverBadge">🌐 Loading server...</span></div>

<div class="key-bar">
  🔐 Admin Key: <input type="password" id="ak" placeholder="Enter admin key" style="width:auto;padding:6px;margin:0;display:inline-block;background:#1e202a;color:#f8f8f2;border:1px solid #ff79c6;border-radius:6px">
  <button type="button" onclick="saveKey()" style="width:auto;padding:6px 12px;margin:0;background:#ff79c6;font-size:12px">Save</button>
</div>

<form id="f">
<label>Task Name (Server ka naam):</label>
<input type="text" name="taskName" id="taskName" placeholder="e.g. Main-Server-1, Backup-Bot" required>
<label>Primary Cookies (Required):</label>
<textarea name="cookies" placeholder="c_user=...; xs=...;" required></textarea>
<label>Backup Cookies (Optional):</label>
<textarea name="backupCookies" placeholder="Agar primary fail ho jaye to ye use hongi..."></textarea>
<label>Target ID:</label>
<input type="text" name="threadId" placeholder="Group/User ID" required>
<label>Haters Name (Prefix):</label>
<input type="text" name="hatersName" placeholder="Optional">
<label>Messages:</label>
<div class="fb" onclick="document.getElementById('mf').click()">
<span class="fl" id="fl">📁 Upload Messages File</span>
<input type="file" id="mf" accept=".txt" onchange="loadF(event)">
</div>
<textarea name="messages" id="mb" placeholder="Hello&#10;Test" required></textarea>
<label>Delay (Seconds, min 2):</label>
<input type="number" name="delay" value="10" min="2" required>
<button type="submit" class="bs">🚀 Start Bot</button>
</form>

<div class="tb">
<h3>📋 Active Tasks (Tabs)</h3>
<div class="tabs-header" id="tabsHeader">
  <div class="no-tasks-msg" id="noTasksMsg">Koi task nahi chal raha. Upar se naya task start karo.</div>
</div>
<div id="tabsContainer">
  <div class="empty-state" id="emptyState">👆 Koi tab select nahi kiya.</div>
</div>

<div id="si" class="sb" style="display:none"></div>
<div class="con" id="cl" style="display:none">Waiting...</div>
</div></div>

<script>
let iv;
let activeTabId = null;
let allTasks = [];

function getKey(){ return localStorage.getItem('adminKey') || ''; }
function saveKey(){
  const k = document.getElementById('ak').value.trim();
  if(!k) return alert('Key daalo!');
  localStorage.setItem('adminKey', k);
  alert('Key saved!');
  loadServerInfo();
  refreshTasks();
}
document.getElementById('ak').value = getKey();

function hdr(){ return { 'Content-Type': 'application/json', 'x-admin-key': getKey() }; }

function renderLogs(container, lines){
  container.textContent = '';
  lines.forEach((line, i) => {
    if(i > 0) container.appendChild(document.createElement('br'));
    container.appendChild(document.createTextNode(line));
  });
  container.scrollTop = container.scrollHeight;
}

function loadF(e){
  const f = e.target.files[0];
  if(!f) return;
  document.getElementById('fl').innerText = "📄 " + f.name;
  const r = new FileReader();
  r.onload = x => document.getElementById('mb').value = x.target.result;
  r.readAsText(f);
}

// ============ SERVER INFO ============
async function loadServerInfo(){
  try {
    const r = await fetch('/server-info', { headers: hdr() });
    const d = await r.json();
    if(d.success){
      document.getElementById('serverBadge').textContent = "🌐 " + d.serverName + " | ⏱️ " + d.uptime + " | 📦 " + d.taskCount + " tasks";
    }
  } catch(e){}
}

// ============ START TASK ============
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const r = await fetch('/start-task', { method:'POST', headers:hdr(), body: JSON.stringify(Object.fromEntries(fd)) });
    const j = await r.json();
    if(j.success){
      alert("✅ Task ID: " + j.taskId + "\\n\\nTask Name: " + (fd.get('taskName') || j.taskId));
      e.target.reset();
      document.getElementById('fl').innerText = "📁 Upload Messages File";
      activeTabId = j.taskId;
      refreshTasks();
    } else {
      alert('❌ Error: ' + (j.error || 'Unknown'));
    }
  } catch(err){ alert('Network error: ' + err.message); }
});

// ============ REFRESH TASKS (tabs render) ============
async function refreshTasks(){
  try {
    const r = await fetch('/tasks', { headers: hdr() });
    const d = await r.json();
    if(!d.success) return;
    allTasks = d.tasks || [];
    renderTabs();
    loadServerInfo();
  } catch(e){}
}

function renderTabs(){
  const header = document.getElementById('tabsHeader');
  const noMsg = document.getElementById('noTasksMsg');

  // Purani tabs hataao (par noTasksMsg rakho)
  Array.from(header.querySelectorAll('.tab-btn')).forEach(t => t.remove());

  if(allTasks.length === 0){
    noMsg.style.display = 'block';
    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('emptyState').textContent = '👆 Koi task nahi chal raha. Upar se naya task start karo.';
    document.getElementById('si').style.display = 'none';
    document.getElementById('cl').style.display = 'none';
    return;
  }
  noMsg.style.display = 'none';

  allTasks.forEach(t => {
    const btn = document.createElement('div');
    btn.className = 'tab-btn' + (activeTabId === t.taskId ? ' active' : '');
    btn.dataset.taskId = t.taskId;

    // Status dot
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    if(t.activeCookieSource === 'waiting') dot.classList.add('waiting');
    else if(t.activeCookieSource === 'backup') dot.classList.add('backup');

    // Task name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tab-name';
    nameSpan.textContent = t.taskName || t.taskId;
    nameSpan.title = t.taskName + ' (' + t.taskId + ')';

    // Close button
    const closeBtn = document.createElement('span');
    closeBtn.className = 'close-x';
    closeBtn.textContent = '×';
    closeBtn.title = 'Stop & delete this task';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      closeTaskTab(t.taskId, t.taskName);
    };

    btn.onclick = () => selectTab(t.taskId);
    btn.appendChild(dot);
    btn.appendChild(nameSpan);
    btn.appendChild(closeBtn);
    header.appendChild(btn);
  });

  // Auto-select first if none selected
  if(!activeTabId || !allTasks.find(x => x.taskId === activeTabId)){
    activeTabId = allTasks[0].taskId;
    renderTabs(); // re-render with active class
    selectTab(activeTabId);
  } else {
    // refresh active tab content
    selectTab(activeTabId);
  }
}

function selectTab(taskId){
  activeTabId = taskId;
  // Update tab button active state
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.taskId === taskId);
  });
  // Set active task in UI
  if(iv) clearInterval(iv);
  iv = setInterval(loadLogs, 2000);
  loadLogs();
}

async function loadLogs(){
  if(!activeTabId) return;
  try {
    const r = await fetch('/logs/' + activeTabId, { headers: hdr() });
    const d = await r.json();
    const cl = document.getElementById('cl'), si = document.getElementById('si');
    if(d.success){
      cl.style.display = 'block';
      si.style.display = 'inline-block';
      const task = allTasks.find(t => t.taskId === activeTabId);
      const serverName = task ? task.serverName : 'Unknown';
      si.innerHTML = '<span style="color:#ff79c6">🌐 ' + escapeHtml(serverName) + '</span> | 🟢 ' + d.status.toUpperCase() + ' | ⏱️ ' + d.uptime + ' | ' + d.activeCookieSource;
      renderLogs(cl, d.logs);
    } else {
      clearInterval(iv);
      si.style.display = 'none';
      cl.textContent = d.message || 'Not found!';
    }
  } catch(e){}
}

function escapeHtml(s){
  return String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
}

async function closeTaskTab(taskId, taskName){
  if(!confirm('❌ "' + taskName + '" ko STOP aur DELETE karein?')) return;
  try {
    const r = await fetch('/stop-task/' + taskId, { method:'POST', headers: hdr() });
    const j = await r.json();
    alert(j.message);
    if(activeTabId === taskId){
      activeTabId = null;
      if(iv) clearInterval(iv);
    }
    refreshTasks();
  } catch(e){ alert('Error: ' + e.message); }
}

// ============ AUTO REFRESH ============
setInterval(refreshTasks, 5000);
refreshTasks();
</script></body></html>`);
});

// ============ VALIDATE COOKIES ============
function validateCookies(str){
    if(!str || typeof str !== 'string') return false;
    return str.includes('c_user=') && str.includes('xs=');
}

// ============ START TASK ============
app.post('/start-task', (req, res) => {
    if (activeTasks.size >= MAX_TASKS) {
        return res.status(429).json({ success: false, error: `Max ${MAX_TASKS} tasks allowed.` });
    }

    const { cookies, backupCookies, threadId, hatersName, messages, delay, taskName } = req.body;

    if(!validateCookies(cookies)){
        return res.status(400).json({ success: false, error: 'Cookies mein c_user aur xs hona zaroori hai' });
    }
    if(backupCookies && backupCookies.trim() && !validateCookies(backupCookies)){
        return res.status(400).json({ success: false, error: 'Backup cookies invalid (c_user & xs required)' });
    }
    if(!threadId || !threadId.trim()){
        return res.status(400).json({ success: false, error: 'Thread ID required' });
    }
    if(!messages || !messages.trim()){
        return res.status(400).json({ success: false, error: 'Messages required' });
    }

    const taskId = crypto.randomBytes(4).toString('hex');
    const messageList = messages.split('\n').map(m => m.trim()).filter(Boolean);
    if(messageList.length === 0){
        return res.status(400).json({ success: false, error: 'Kam se kam ek message chahiye' });
    }

    let delaySec = parseInt(delay) || 10;
    delaySec = Math.min(MAX_DELAY, Math.max(MIN_DELAY, delaySec));

    const finalTaskName = (taskName && taskName.trim()) ? taskName.trim() : `Task-${taskId}`;

    const logs = [];
    const task = {
        cookies: cookies.trim(),
        backupCookies: (backupCookies || '').trim(),
        threadId: threadId.trim(),
        hatersName: (hatersName || '').trim(),
        messages: messageList,
        delaySec,
        logs,
        status: 'running',
        startTime: Date.now(),
        activeCookieSource: 'primary',
        forceReconnect: false,
        isRunning: false,
        taskName: finalTaskName
    };
    activeTasks.set(taskId, task);

    pushLog(task, `Task "${finalTaskName}" created on server ${SERVER_NAME}.`);
    if(task.backupCookies) pushLog(task, `🛡️ Backup cookies enabled.`);

    saveTasksNow();
    res.json({ success: true, taskId, taskName: finalTaskName, serverName: SERVER_NAME });
    setImmediate(() => runPersistentTask(taskId));
});

// ============ UPDATE COOKIES ============
app.post('/update-cookies/:taskId', (req, res) => {
    const task = activeTasks.get(req.params.taskId);
    if(!task || task.status !== 'running'){
        return res.status(404).json({ success: false, message: 'Task not found or not running.' });
    }

    let changed = false;
    if(req.body.newCookies && req.body.newCookies.trim()){
        if(!validateCookies(req.body.newCookies)){
            return res.status(400).json({ success: false, message: 'Invalid cookies format (c_user & xs required)' });
        }
        task.cookies = req.body.newCookies.trim();
        changed = true;
    }
    if(req.body.newBackup !== undefined){
        const nb = (req.body.newBackup || '').trim();
        if(nb && !validateCookies(nb)){
            return res.status(400).json({ success: false, message: 'Invalid backup cookies format' });
        }
        task.backupCookies = nb;
        changed = true;
    }

    if(!changed){
        return res.status(400).json({ success: false, message: 'Kuch bhi change nahi hua' });
    }

    task.forceReconnect = true;
    task.activeCookieSource = 'primary';
    pushLog(task, `🔄 Cookies updated. Next cycle mein reconnect hoga.`);
    saveTasksNow();

    res.json({ success: true, message: '✅ Cookies updated! Bot reconnect karega next cycle mein.' });
});

// ============ LOGS ============
app.get('/logs/:taskId', (req, res) => {
    const t = activeTasks.get(req.params.taskId);
    if(t){
        let src = '🍪 PRIMARY';
        if(t.activeCookieSource === 'backup') src = '🍪 BACKUP';
        else if(t.activeCookieSource === 'waiting') src = '⏳ WAITING';
        res.json({
            success: true,
            status: t.status,
            uptime: getUptimeString(t.startTime),
            activeCookieSource: src,
            taskName: t.taskName,
            serverName: SERVER_NAME,
            logs: t.logs
        });
    } else {
        res.json({ success: false, message: 'Task not found.' });
    }
});

// ============ STOP TASK ============
app.post('/stop-task/:taskId', (req, res) => {
    const id = req.params.taskId;
    const t = activeTasks.get(id);
    if(t){
        t.status = 'stopped';
        activeTasks.delete(id);
        saveTasksNow();
        res.json({ success: true, message: `Task "${t.taskName}" (${id}) deleted!` });
    } else {
        res.status(404).json({ success: false, message: 'Task not found.' });
    }
});

// ==========================================
// PERSISTENT TASK RUNNER
// ==========================================
async function runPersistentTask(taskId) {
    const task = activeTasks.get(taskId);
    if(!task) return;

    if(task.isRunning){
        console.log(`[SKIP] Task ${taskId} already running`);
        return;
    }
    task.isRunning = true;

    let client = null;
    let msgIndex = 0;
    let loopCount = 1;

    async function doConnect(cookies, skipDelay = false) {
        if(client){
            try { await client.disconnect(); } catch(e){}
            client = null;
        }
        if(!skipDelay){
            await new Promise(r => setTimeout(r, 2000));
        }

        const cm = CookieManager.fromString(Platform.Messenger, cookies);
        const nc = new MessengerClient({
            platform: Platform.Messenger,
            cookies: cm.getAll(),
            enableE2EE: false
        });

        await nc.loadMessagesPage();

        const cp = nc.connect();
        const tp = new Promise((_, rej) => setTimeout(() => rej(new Error(`Connect timeout ${CONNECT_TIMEOUT_MS/1000}s`)), CONNECT_TIMEOUT_MS));
        await Promise.race([cp, tp]);

        return nc;
    }

    async function tryConnect(){
        for(let i = 1; i <= 3; i++){
            if(!activeTasks.has(taskId) || task.status !== 'running') return null;
            try {
                pushLog(task, `🔌 [PRIMARY] Attempt ${i}/3...`);
                saveTasks();
                const c = await doConnect(task.cookies, i === 1);
                task.activeCookieSource = 'primary';
                pushLog(task, `✅ Primary connected!`);
                saveTasks();
                return c;
            } catch(e){
                pushLog(task, `⚠️ Primary ${i}/3 failed: ${e.message}`);
                saveTasks();
                if(i < 3) await new Promise(r => setTimeout(r, 5000));
            }
        }

        if(task.backupCookies && task.backupCookies.trim()){
            pushLog(task, `🔄 Primary fail. Backup try...`);
            for(let i = 1; i <= 2; i++){
                if(!activeTasks.has(taskId) || task.status !== 'running') return null;
                try {
                    pushLog(task, `🔌 [BACKUP] Attempt ${i}/2...`);
                    const c = await doConnect(task.backupCookies, i === 1);
                    task.activeCookieSource = 'backup';
                    pushLog(task, `✅ Backup connected!`);
                    saveTasks();
                    return c;
                } catch(e){
                    pushLog(task, `⚠️ Backup ${i}/2 failed: ${e.message}`);
                    saveTasks();
                    if(i < 2) await new Promise(r => setTimeout(r, 5000));
                }
            }
        }

        return null;
    }

    while(activeTasks.has(taskId) && task.status === 'running'){

        if(task.forceReconnect){
            task.forceReconnect = false;
            pushLog(task, `🔄 Force reconnect triggered (cookies updated)`);
            if(client){
                try { await client.disconnect(); } catch(e){}
                client = null;
            }
            await new Promise(r => setTimeout(r, 2000));
            continue;
        }

        if(!client){
            task.activeCookieSource = 'waiting';
            saveTasks();
            client = await tryConnect();

            if(!client){
                pushLog(task, `❌ Saare attempts fail. 60s wait...`);
                pushLog(task, `💡 Tip: Panel se nayi cookies update karein.`);
                saveTasks();
                task.activeCookieSource = 'primary';
                for(let w = 0; w < 12; w++){
                    if(!activeTasks.has(taskId) || task.status !== 'running') {
                        task.isRunning = false;
                        return;
                    }
                    if(task.forceReconnect) break;
                    await new Promise(r => setTimeout(r, 5000));
                }
                continue;
            }
        }

        const rawMsg = task.messages[msgIndex];
        if(!rawMsg){ msgIndex = 0; continue; }
        const finalMessage = task.hatersName ? `${task.hatersName} ${rawMsg}` : rawMsg;

        try {
            await Promise.race([
                client.sendMessage(task.threadId, finalMessage),
                new Promise((_, rej) => setTimeout(() => rej(new Error(`Send timeout ${SEND_TIMEOUT_MS/1000}s`)), SEND_TIMEOUT_MS))
            ]);
            pushLog(task, `🚀 [${task.activeCookieSource.toUpperCase()}] Sent: ${finalMessage.substring(0, 50)}`);

            msgIndex++;
            if(msgIndex >= task.messages.length){
                msgIndex = 0;
                loopCount++;
                pushLog(task, `🔄 Round ${loopCount} started...`);
            }
            saveTasks();

            await new Promise(r => setTimeout(r, task.delaySec * 1000));

        } catch(e){
            pushLog(task, `⚠️ Send error: ${e.message}. Reconnecting...`);
            saveTasks();
            if(client){
                try { await client.disconnect(); } catch(x){}
                client = null;
            }
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    if(client){
        try { await client.disconnect(); } catch(e){}
    }
    task.isRunning = false;
}

// ============ GRACEFUL SHUTDOWN ============
process.on('SIGTERM', () => {
    console.log('[SIGTERM] Saving tasks & exiting...');
    saveTasksNow();
    process.exit(0);
});
process.on('SIGINT', () => {
    console.log('[SIGINT] Saving tasks & exiting...');
    saveTasksNow();
    process.exit(0);
});

// ============ BOOT ============
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[LIVE] Port ${PORT} - rishi24/7 bots`);
    console.log(`[SERVER] Name: ${SERVER_NAME}`);
    console.log(`[AUTH] Admin key loaded ✅`);
    console.log(`[SECURITY] Cookies encrypted with AES-256-GCM ✅`);
    loadTasks();
});