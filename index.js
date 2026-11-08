global.WebSocket = require('ws');

const express = require('express');
const { MessengerClient, Platform, CookieManager } = require('messagix-js');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = './tasks.json';
const ADMIN_KEY = process.env.ADMIN_KEY || 'rishi1998'; // 🔐 DEFAULT KEY

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============ ANTI-CRASH ============
process.on('uncaughtException', (err) => {
    console.error('[ANTI-CRASH] Uncaught:', err.stack || err.message);
});
process.on('unhandledRejection', (r) => {
    console.error('[ANTI-CRASH] Rejection:', r?.stack || r);
});

const activeTasks = new Map();

// ============ THROTTLED SAVE (2s) ============
let saveTimer = null;
function saveTasks() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        const out = {};
        for (const [id, t] of activeTasks.entries()) {
            out[id] = {
                cookies: t.cookies,
                backupCookies: t.backupCookies || '',
                threadId: t.threadId,
                hatersName: t.hatersName,
                messages: t.messages,
                delaySec: t.delaySec,
                status: t.status,
                startTime: t.startTime,
                logs: t.logs.slice(-60),
                activeCookieSource: t.activeCookieSource || 'primary'
            };
        }
        try {
            fs.writeFileSync(DB_FILE, JSON.stringify(out, null, 2));
        } catch (e) {
            console.error('[SAVE ERROR]', e.message);
        }
    }, 2000);
}

function saveTasksNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const out = {};
    for (const [id, t] of activeTasks.entries()) {
        out[id] = {
            cookies: t.cookies, backupCookies: t.backupCookies || '',
            threadId: t.threadId, hatersName: t.hatersName,
            messages: t.messages, delaySec: t.delaySec,
            status: t.status, startTime: t.startTime,
            logs: t.logs.slice(-60), activeCookieSource: t.activeCookieSource || 'primary'
        };
    }
    try { fs.writeFileSync(DB_FILE, JSON.stringify(out, null, 2)); } catch(e) {}
}

function getUptimeString(startTime) {
    const diff = Date.now() - startTime;
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${d}D ${h}H ${m}M`;
}

// ============ LOG HELPER (auto trim) ============
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
                taskData.forceReconnect = false;
                taskData.isRunning = false;
                activeTasks.set(taskId, taskData);
                console.log(`[AUTO-DEPLOY] Restoring: ${taskId}`);
                runPersistentTask(taskId);
            }
        }
    } catch (e) {
        console.error("[LOAD ERROR]", e.stack || e.message);
    }
}

// ============ AUTH MIDDLEWARE ============
app.use((req, res, next) => {
    if (req.path === '/' || req.path === '/ping') return next();
    if (req.method === 'HEAD') return next();
    
    const key = req.headers['x-admin-key'] || req.query.key;
    if (key !== ADMIN_KEY) {
        return res.status(401).json({ success: false, error: 'Unauthorized. Admin key required.' });
    }
    next();
});

// ============ PUBLIC ROUTES ============
app.head('/', (req, res) => res.status(200).end());
app.get('/ping', (req, res) => res.send('Pong'));

// ============ HTML UI ============
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="hi"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>⚡ RAJ BABA 24/7 Bot ⚡</title>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{
  font-family:'Rajdhani',sans-serif;
  background:#05070d;
  background-image:
    radial-gradient(circle at 20% 10%, rgba(0,180,255,.18), transparent 45%),
    radial-gradient(circle at 85% 90%, rgba(255,0,90,.20), transparent 45%),
    radial-gradient(circle at 50% 50%, rgba(120,0,255,.12), transparent 60%),
    repeating-linear-gradient(0deg, rgba(0,255,255,.04) 0px, rgba(0,255,255,.04) 1px, transparent 1px, transparent 40px),
    repeating-linear-gradient(90deg, rgba(0,255,255,.04) 0px, rgba(0,255,255,.04) 1px, transparent 1px, transparent 40px);
  color:#e6f7ff;
  padding:20px;margin:0;min-height:100vh;
}
.c{
  max-width:680px;margin:auto;
  background:linear-gradient(160deg, rgba(10,18,35,.92), rgba(5,8,18,.96));
  padding:30px;border-radius:20px;
  border:1.5px solid rgba(0,200,255,.45);
  box-shadow:
    0 0 25px rgba(0,180,255,.25),
    0 0 60px rgba(255,0,90,.12),
    inset 0 0 40px rgba(0,120,255,.08);
}
h2{
  text-align:center;margin:0 0 10px;
  font-family:'Orbitron',sans-serif;font-weight:900;
  font-size:22px;letter-spacing:1px;
  color:#00e5ff;
  text-shadow:0 0 8px rgba(0,229,255,.9),0 0 20px rgba(0,229,255,.6);
}
.b{
  text-align:center;
  background:linear-gradient(135deg,#ff005c,#8a2be2,#00e5ff);
  color:#fff;display:block;padding:6px 16px;border-radius:20px;
  font-size:12px;font-weight:700;margin:0 auto 22px;width:fit-content;
  font-family:'Orbitron',sans-serif;letter-spacing:1px;
  box-shadow:0 0 18px rgba(255,0,92,.6);
}
label{
  font-weight:600;margin-top:16px;display:block;font-size:14px;
  color:#7fe9ff;letter-spacing:.4px;
}
input,textarea{
  width:100%;padding:12px;margin-top:6px;border-radius:10px;
  border:1.5px solid rgba(0,200,255,.35);
  background:rgba(3,10,22,.85);
  color:#eaffff;font-family:'Rajdhani',sans-serif;font-size:15px;
  outline:none;transition:.25s;
}
input:focus,textarea:focus{
  border-color:#00e5ff;
  box-shadow:0 0 12px rgba(0,229,255,.6);
}
textarea{height:80px;resize:vertical}
.fb{
  margin-top:6px;background:rgba(255,0,92,.08);
  border:1.5px dashed #ff2e6e;
  padding:12px;border-radius:10px;text-align:center;cursor:pointer;
}
.fb input{display:none}
.fl{color:#ff5c8a;font-weight:600;font-size:13px;cursor:pointer}
button{
  padding:14px;border:none;border-radius:10px;font-weight:700;cursor:pointer;
  font-size:15px;width:100%;margin-top:15px;color:#fff;
  font-family:'Orbitron',sans-serif;letter-spacing:1px;
}
button:hover{filter:brightness(1.15)}
.bs{background:linear-gradient(135deg,#00e5ff,#0066ff,#8a2be2);box-shadow:0 0 20px rgba(0,180,255,.55)}
.bc{background:linear-gradient(135deg,#00c6ff,#0072ff)}
.bt{background:linear-gradient(135deg,#ff005c,#c2003f)}
.con{
  background:#020409;
  border:1px solid rgba(0,229,255,.35);
  color:#4dff9a;padding:15px;border-radius:10px;height:250px;overflow-y:auto;
  font-family:'Courier New',monospace;font-size:12.5px;margin-top:10px;
  line-height:1.5;
}
.tb{
  margin-top:30px;border-top:1.5px dashed rgba(0,200,255,.35);
  padding:18px;background:rgba(8,14,28,.6);border-radius:15px;
}
.tb h3{
  font-family:'Orbitron',sans-serif;color:#ff5c8a;
  margin:0 0 8px;font-size:16px;
}
.sb{
  display:inline-block;padding:6px 14px;border-radius:12px;font-size:12.5px;
  font-weight:700;background:rgba(0,229,255,.12);color:#00e5ff;
  border:1px solid rgba(0,229,255,.5);
  margin-top:12px;font-family:'Orbitron',sans-serif;
}
.key-bar{
  background:rgba(255,0,92,.1);border:1.5px solid #ff2e6e;
  padding:10px;border-radius:10px;margin-bottom:15px;
  font-size:13px;color:#ff5c8a;text-align:center;
}
</style></head><body><div class="c">
<h2>⚡ RAJ BABA 24/7 BOT ⚡</h2>
<span class="b">DEVELOPER: THE LEGEND BOY RAJ BABA</span>

<div class="key-bar">
  🔐 Admin Key: <input type="password" id="ak" placeholder="Enter admin key" style="width:auto;padding:6px;margin:0;display:inline-block;background:#020409;color:#eaffff;border:1px solid #ff2e6e;border-radius:6px">
  <button type="button" onclick="saveKey()" style="width:auto;padding:6px 12px;margin:0;background:#ff2e6e;font-size:12px">Save</button>
</div>

<form id="f">
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
<label>Delay (Seconds):</label>
<input type="number" name="delay" value="10" min="2" required>
<button type="submit" class="bs">🚀 Start Bot</button>
</form>

<div class="tb">
<h3>🔍 Task Control</h3>
<label>Task ID:</label>
<input type="text" id="tid" placeholder="Paste Task ID">
<div style="display:flex;gap:10px">
<button type="button" class="bc" onclick="check()">👁️ Check</button>
<button type="button" class="bt" onclick="del()">🗑️ Delete</button>
</div>
<div style="margin-top:15px;border-top:1px dashed rgba(0,200,255,.25);padding-top:12px">
<label>Update Primary Cookies:</label>
<textarea id="nc" placeholder="Nayi primary cookies" style="height:50px"></textarea>
<label>Update Backup Cookies:</label>
<textarea id="nb" placeholder="Nayi backup cookies" style="height:50px"></textarea>
<button type="button" class="bc" onclick="upd()">🔄 Update Cookies</button>
</div>
<div id="si" class="sb" style="display:none"></div>
<div class="con" id="cl">Waiting...</div>
</div></div>

<script>
let iv;
function getKey(){ return localStorage.getItem('adminKey') || ''; }
function saveKey(){
  const k = document.getElementById('ak').value.trim();
  if(!k) return alert('Key daalo!');
  localStorage.setItem('adminKey', k);
  alert('Key saved!');
}
document.getElementById('ak').value = getKey();

function hdr(){
  return { 'Content-Type': 'application/json', 'x-admin-key': getKey() };
}

function loadF(e){
  const f = e.target.files[0];
  if(!f) return;
  document.getElementById('fl').innerText = "📄 " + f.name;
  const r = new FileReader();
  r.onload = x => document.getElementById('mb').value = x.target.result;
  r.readAsText(f);
}

document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const r = await fetch('/start-task', {
      method: 'POST',
      headers: hdr(),
      body: JSON.stringify(Object.fromEntries(fd))
    });
    const j = await r.json();
    if(j.success){
      alert("✅ Task ID: " + j.taskId + "\\n\\nIse save karein!");
      document.getElementById('tid').value = j.taskId;
      check();
    } else {
      alert('❌ Error: ' + (j.error || 'Unknown'));
    }
  } catch(err){ alert('Network error: ' + err.message); }
});

function check(){
  const id = document.getElementById('tid').value.trim();
  if(!id) return alert('Task ID daaliye!');
  if(iv) clearInterval(iv);
  iv = setInterval(async () => {
    try {
      const r = await fetch('/logs/' + id, { headers: hdr() });
      const d = await r.json();
      const cl = document.getElementById('cl'), si = document.getElementById('si');
      if(d.success){
        si.style.display = "block";
        si.innerHTML = "🟢 " + d.status.toUpperCase() + " | ⏱️ " + d.uptime + " | " + d.activeCookieSource;
        cl.innerHTML = d.logs.join('<br>');
        cl.scrollTop = cl.scrollHeight;
      } else {
        clearInterval(iv);
        si.style.display = "none";
        cl.innerHTML = d.message || "Not found!";
      }
    } catch(e){}
  }, 2000);
}

async function del(){
  const id = document.getElementById('tid').value.trim();
  if(!id) return alert('Task ID daaliye!');
  if(!confirm("STOP aur DELETE karein?")) return;
  try {
    const r = await fetch('/stop-task/' + id, { method: 'POST', headers: hdr() });
    const j = await r.json();
    alert(j.message);
    if(iv) clearInterval(iv);
    document.getElementById('cl').innerHTML = "Deleted.";
    document.getElementById('si').style.display = "none";
  } catch(e){ alert('Error: ' + e.message); }
}

async function upd(){
  const id = document.getElementById('tid').value.trim();
  const nc = document.getElementById('nc').value.trim();
  const nb = document.getElementById('nb').value.trim();
  if(!id) return alert('Task ID daaliye!');
  if(!nc && !nb) return alert('Cookies daaliye!');
  try {
    const r = await fetch('/update-cookies/' + id, {
      method: 'POST',
      headers: hdr(),
      body: JSON.stringify({ newCookies: nc, newBackup: nb })
    });
    const j = await r.json();
    alert(j.message);
    if(j.success){
      document.getElementById('nc').value = '';
      document.getElementById('nb').value = '';
    }
  } catch(e){ alert('Error: ' + e.message); }
}
</script></body></html>`);
});

// ============ VALIDATE COOKIES ============
function validateCookies(str){
    if(!str || typeof str !== 'string') return false;
    return str.includes('c_user=') && str.includes('xs=');
}

// ============ START TASK ============
app.post('/start-task', (req, res) => {
    const { cookies, backupCookies, threadId, hatersName, messages, delay } = req.body;

    if(!validateCookies(cookies)){
        return res.status(400).json({ success: false, error: 'Cookies mein c_user aur xs hona zaroori hai' });
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

    const logs = [];
    const task = {
        cookies: cookies.trim(),
        backupCookies: (backupCookies || '').trim(),
        threadId: threadId.trim(),
        hatersName: (hatersName || '').trim(),
        messages: messageList,
        delaySec: Math.max(2, parseInt(delay) || 10),
        logs,
        status: 'running',
        startTime: Date.now(),
        activeCookieSource: 'primary',
        forceReconnect: false,
        isRunning: false
    };
    activeTasks.set(taskId, task);

    pushLog(task, `Task ${taskId} created.`);
    if(task.backupCookies) pushLog(task, `🛡️ Backup cookies enabled.`);

    saveTasksNow();
    res.json({ success: true, taskId });

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
        task.backupCookies = (req.body.newBackup || '').trim();
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
        res.json({ success: true, message: `Task ${id} deleted!` });
    } else {
        res.status(404).json({ success: false, message: 'Task not found.' });
    }
});

// ==========================================
// 🚀 PERSISTENT TASK RUNNER
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
        const tp = new Promise((_, rej) => setTimeout(() => rej(new Error('Connect timeout 25s')), 25000));
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

    // ========== MAIN LOOP ==========
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
            await client.sendMessage(task.threadId, finalMessage);
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
    console.log(`[LIVE] Port ${PORT} - RAJ BABA 24/7 Bot`);
    console.log(`[AUTH] Admin key: ${ADMIN_KEY === 'rishi1998' ? '✅ rishi1998 (default)' : '✅ Custom (env)'}`);
    loadTasks();
});