global.WebSocket = require('ws');

const express = require('express');
const { MessengerClient, Platform, CookieManager } = require('messagix-js');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = './tasks.json';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

process.on('uncaughtException', (err) => console.error('[ANTI-CRASH]', err.message));
process.on('unhandledRejection', (r) => console.error('[ANTI-CRASH]', r));

const activeTasks = new Map();

function getUptimeString(startTime) {
    const diff = Date.now() - startTime;
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${d} Days, ${h} Hours, ${m} Mins`;
}

function loadTasks() {
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            for (const [taskId, taskData] of Object.entries(data)) {
                if (taskData.status === 'running') {
                    activeTasks.set(taskId, { ...taskData });
                    console.log(`[AUTO-DEPLOY] Restoring: ${taskId}`);
                    runPersistentTask(taskId);
                }
            }
        } catch (e) { console.error("Load error:", e.message); }
    }
}

function saveTasks() {
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

app.head('/', (req, res) => res.status(200).end());
app.get('/ping', (req, res) => res.send('Pong'));

// ==================== HTML UI (CYBERPUNK NEON THEME) ====================
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="hi"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>rishi dc server</title>
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
  position:relative;
  overflow-x:hidden;
}
body::after{
  content:"";
  position:fixed;inset:0;
  background:repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,.22) 3px, rgba(0,0,0,0) 4px);
  pointer-events:none;z-index:9999;
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
  position:relative;
}
.c::before{
  content:"";
  position:absolute;inset:-2px;border-radius:22px;
  background:linear-gradient(120deg,#00e5ff,#ff005c,#8a2be2,#00e5ff);
  background-size:300% 300%;
  z-index:-1;filter:blur(14px);opacity:.55;
  animation:glow 8s linear infinite;
}
@keyframes glow{
  0%{background-position:0% 50%}
  50%{background-position:100% 50%}
  100%{background-position:0% 50%}
}
h2{
  text-align:center;margin:0 0 10px;
  font-family:'Orbitron',sans-serif;font-weight:900;
  font-size:22px;letter-spacing:1px;
  color:#00e5ff;
  text-shadow:0 0 8px rgba(0,229,255,.9),0 0 20px rgba(0,229,255,.6),0 0 35px rgba(0,120,255,.4);
}
.b{
  text-align:center;
  background:linear-gradient(135deg,#ff005c,#8a2be2,#00e5ff);
  color:#fff;display:block;padding:6px 16px;border-radius:20px;
  font-size:12px;font-weight:700;margin:0 auto 22px;width:fit-content;
  font-family:'Orbitron',sans-serif;letter-spacing:1px;
  box-shadow:0 0 18px rgba(255,0,92,.6),0 0 28px rgba(0,229,255,.35);
  text-shadow:0 0 6px rgba(0,0,0,.6);
}
label{
  font-weight:600;margin-top:16px;display:block;font-size:14px;
  color:#7fe9ff;letter-spacing:.4px;
  text-shadow:0 0 6px rgba(0,200,255,.5);
}
input,textarea{
  width:100%;padding:12px;margin-top:6px;border-radius:10px;
  border:1.5px solid rgba(0,200,255,.35);
  background:rgba(3,10,22,.85);
  color:#eaffff;font-family:'Rajdhani',sans-serif;font-size:15px;
  outline:none;transition:.25s;
  box-shadow:inset 0 0 12px rgba(0,150,255,.12);
}
input::placeholder,textarea::placeholder{color:#5c7d99}
input:focus,textarea:focus{
  border-color:#00e5ff;
  box-shadow:0 0 12px rgba(0,229,255,.6), inset 0 0 12px rgba(0,150,255,.2);
  background:rgba(5,15,30,.95);
}
textarea{height:80px;resize:vertical}
.fb{
  margin-top:6px;
  background:rgba(255,0,92,.08);
  border:1.5px dashed #ff2e6e;
  padding:12px;border-radius:10px;text-align:center;cursor:pointer;
  transition:.25s;
}
.fb:hover{background:rgba(255,0,92,.18);box-shadow:0 0 15px rgba(255,0,92,.4)}
.fb input{display:none}
.fl{color:#ff5c8a;font-weight:600;font-size:13px;cursor:pointer;text-shadow:0 0 8px rgba(255,0,92,.6)}
button{
  padding:14px;border:none;border-radius:10px;font-weight:700;cursor:pointer;
  font-size:15px;width:100%;margin-top:15px;color:#fff;
  font-family:'Orbitron',sans-serif;letter-spacing:1px;
  transition:.25s;text-shadow:0 0 6px rgba(0,0,0,.5);
}
button:hover{transform:translateY(-2px);filter:brightness(1.15)}
button:active{transform:translateY(0)}
.bs{background:linear-gradient(135deg,#00e5ff,#0066ff,#8a2be2);box-shadow:0 0 20px rgba(0,180,255,.55)}
.bc{background:linear-gradient(135deg,#00c6ff,#0072ff);box-shadow:0 0 20px rgba(0,140,255,.55)}
.bt{background:linear-gradient(135deg,#ff005c,#c2003f);box-shadow:0 0 20px rgba(255,0,92,.55)}
.con{
  background:#020409;
  border:1px solid rgba(0,229,255,.35);
  color:#4dff9a;padding:15px;border-radius:10px;height:250px;overflow-y:auto;
  font-family:'Courier New',monospace;font-size:12.5px;margin-top:10px;
  box-shadow:inset 0 0 25px rgba(0,255,150,.1);
  text-shadow:0 0 5px rgba(77,255,154,.55);
  line-height:1.5;
}
.con::-webkit-scrollbar{width:8px}
.con::-webkit-scrollbar-track{background:#04070f}
.con::-webkit-scrollbar-thumb{background:linear-gradient(#00e5ff,#8a2be2);border-radius:10px}
.tb{
  margin-top:30px;
  border-top:1.5px dashed rgba(0,200,255,.35);
  padding:18px;
  background:rgba(8,14,28,.6);
  border-radius:15px;
  box-shadow:inset 0 0 25px rgba(0,120,255,.08);
}
.tb h3{
  font-family:'Orbitron',sans-serif;color:#ff5c8a;
  text-shadow:0 0 10px rgba(255,0,92,.7);
  letter-spacing:1px;margin:0 0 8px;font-size:16px;
}
.sb{
  display:inline-block;padding:6px 14px;border-radius:12px;font-size:12.5px;
  font-weight:700;background:rgba(0,229,255,.12);color:#00e5ff;
  border:1px solid rgba(0,229,255,.5);
  margin-top:12px;
  text-shadow:0 0 8px rgba(0,229,255,.7);
  box-shadow:0 0 15px rgba(0,229,255,.25);
  font-family:'Orbitron',sans-serif;letter-spacing:.5px;
}
</style></head><body><div class="c">
<h2>⚡ 24/7 RAJ BABA OFLINE SERVER ⚡</h2>
<span class="b">DEVELOPER: THE LEGEND BOY RAJ BABA</span>
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
<button type="submit" class="bs">🚀 Start kro phir task id copy kr lena pop up wala yadd s</button>
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
function loadF(e){const f=e.target.files[0];if(!f)return;document.getElementById('fl').innerText="📄 "+f.name;const r=new FileReader();r.onload=x=>document.getElementById('mb').value=x.target.result;r.readAsText(f);}
document.getElementById('f').addEventListener('submit',async e=>{
e.preventDefault();
const fd=new FormData(e.target);
const r=await fetch('/start-task',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(fd))});
const j=await r.json();
if(j.success){alert("Task ID: "+j.taskId+"\\n\\nIse save karein!");document.getElementById('tid').value=j.taskId;check();}
else alert('Error: '+j.error);
});
function check(){
const id=document.getElementById('tid').value.trim();
if(!id)return alert('Task ID daaliye!');
if(iv)clearInterval(iv);
iv=setInterval(async()=>{
try{
const r=await fetch('/logs/'+id);const d=await r.json();
const cl=document.getElementById('cl'),si=document.getElementById('si');
if(d.success){
si.style.display="block";
si.innerHTML="🟢 "+d.status.toUpperCase()+" | ⏱️ "+d.uptime+" | "+d.activeCookieSource;
cl.innerHTML=d.logs.join('<br>');cl.scrollTop=cl.scrollHeight;
}else{clearInterval(iv);si.style.display="none";cl.innerHTML=d.message||"Not found!";}
}catch(e){}
},2000);
}
async function del(){
const id=document.getElementById('tid').value.trim();
if(!id)return alert('Task ID daaliye!');
if(confirm("STOP aur DELETE karein?")){
const r=await fetch('/stop-task/'+id,{method:'POST'});const j=await r.json();
alert(j.message);if(iv)clearInterval(iv);
document.getElementById('cl').innerHTML="Deleted.";document.getElementById('si').style.display="none";
}
}
async function upd(){
const id=document.getElementById('tid').value.trim();
const nc=document.getElementById('nc').value.trim();
const nb=document.getElementById('nb').value.trim();
if(!id)return alert('Task ID daaliye!');
if(!nc&&!nb)return alert('Cookies daaliye!');
const r=await fetch('/update-cookies/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newCookies:nc,newBackup:nb})});
const j=await r.json();alert(j.message);
if(j.success){document.getElementById('nc').value='';document.getElementById('nb').value='';}
}
</script></body></html>`);
});

// ==================== START TASK ====================
app.post('/start-task', (req, res) => {
    const { cookies, backupCookies, threadId, hatersName, messages, delay } = req.body;
    const taskId = crypto.randomBytes(4).toString('hex');
    const messageList = messages.split('\n').map(m => m.trim()).filter(Boolean);
    const logs = [`[${new Date().toLocaleTimeString()}] Task ${taskId} created.`];
    if (backupCookies && backupCookies.trim()) logs.push(`[${new Date().toLocaleTimeString()}] 🛡️ Backup cookies enabled.`);

    activeTasks.set(taskId, {
        cookies, backupCookies: (backupCookies || '').trim(),
        threadId, hatersName, messages: messageList,
        delaySec: parseInt(delay) || 10, logs, status: 'running',
        startTime: Date.now(), activeCookieSource: 'primary'
    });

    saveTasks();
    res.json({ success: true, taskId });
    runPersistentTask(taskId);
});

// ==================== UPDATE COOKIES ====================
app.post('/update-cookies/:taskId', (req, res) => {
    const task = activeTasks.get(req.params.taskId);
    if (task && task.status === 'running') {
        if (req.body.newCookies) task.cookies = req.body.newCookies;
        if (req.body.newBackup !== undefined) task.backupCookies = req.body.newBackup;
        task.forceReconnect = true;
        task.activeCookieSource = 'primary';
        saveTasks();
        res.json({ success: true, message: 'Cookies updated! Bot next cycle mein nayi cookies use karega.' });
    } else res.status(404).json({ success: false, message: 'Task not found.' });
});

// ==========================================
// 🚀 PERSISTENT TASK RUNNER (Simple & Reliable)
// ==========================================
async function runPersistentTask(taskId) {
    const task = activeTasks.get(taskId);
    if (!task) return;

    let client = null;
    let msgIndex = 0;
    let loopCount = 1;

    async function doConnect(cookies) {
        if (client) {
            try { await client.disconnect(); } catch(e) {}
            client = null;
        }
        await new Promise(r => setTimeout(r, 3000));

        const cm = CookieManager.fromString(Platform.Messenger, cookies);
        const nc = new MessengerClient({
            platform: Platform.Messenger,
            cookies: cm.getAll(),
            enableE2EE: false
        });

        await nc.loadMessagesPage();

        const cp = nc.connect();
        const tp = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout 25s')), 25000));
        await Promise.race([cp, tp]);

        return nc;
    }

    while (activeTasks.has(taskId) && task.status === 'running') {

        if (!client) {
            let connected = false;

            // ----- PHASE 1: PRIMARY COOKIES (3 tries) -----
            for (let i = 1; i <= 3; i++) {
                if (!activeTasks.has(taskId) || task.status !== 'running') return;
                try {
                    task.logs.push(`[${new Date().toLocaleTimeString()}] 🔌 [PRIMARY] Attempt ${i}/3...`);
                    saveTasks();
                    client = await doConnect(task.cookies);
                    task.activeCookieSource = 'primary';
                    task.logs.push(`[${new Date().toLocaleTimeString()}] ✅ Primary connected!`);
                    saveTasks();
                    connected = true;
                    break;
                } catch (e) {
                    task.logs.push(`[${new Date().toLocaleTimeString()}] ⚠️ Primary ${i}/3 failed: ${e.message}`);
                    saveTasks();
                    if (i < 3) await new Promise(r => setTimeout(r, 5000));
                }
            }

            // ----- PHASE 2: BACKUP COOKIES (2 tries) -----
            if (!connected && task.backupCookies && task.backupCookies.trim()) {
                task.logs.push(`[${new Date().toLocaleTimeString()}] 🔄 Primary fail. Backup try...`);
                saveTasks();
                for (let i = 1; i <= 2; i++) {
                    if (!activeTasks.has(taskId) || task.status !== 'running') return;
                    try {
                        task.logs.push(`[${new Date().toLocaleTimeString()}] 🔌 [BACKUP] Attempt ${i}/2...`);
                        saveTasks();
                        client = await doConnect(task.backupCookies);
                        task.activeCookieSource = 'backup';
                        task.logs.push(`[${new Date().toLocaleTimeString()}] ✅ Backup connected!`);
                        saveTasks();
                        connected = true;
                        break;
                    } catch (e) {
                        task.logs.push(`[${new Date().toLocaleTimeString()}] ⚠️ Backup ${i}/2 failed: ${e.message}`);
                        saveTasks();
                        if (i < 2) await new Promise(r => setTimeout(r, 5000));
                    }
                }
            }

            // ----- PHASE 3: SAB FAIL (60s wait) -----
            if (!connected) {
                task.logs.push(`[${new Date().toLocaleTimeString()}] ❌ Saare attempts fail. 60s wait karke phir try...`);
                task.logs.push(`[${new Date().toLocaleTimeString()}] 💡 Tip: Panel se nayi cookies update karein.`);
                saveTasks();
                task.activeCookieSource = 'primary';
                for (let w = 0; w < 12; w++) {
                    if (!activeTasks.has(taskId) || task.status !== 'running') return;
                    await new Promise(r => setTimeout(r, 5000));
                }
                continue;
            }
        }

        const rawMsg = task.messages[msgIndex];
        const finalMessage = task.hatersName ? `${task.hatersName} ${rawMsg}` : rawMsg;

        try {
            await client.sendMessage(task.threadId, finalMessage);
            task.logs.push(`[${new Date().toLocaleTimeString()}] 🚀 [${task.activeCookieSource.toUpperCase()}] Sent: ${finalMessage}`);

            msgIndex++;
            if (msgIndex >= task.messages.length) {
                msgIndex = 0;
                loopCount++;
                task.logs.push(`[${new Date().toLocaleTimeString()}] 🔄 Round ${loopCount} started...`);
            }
            if (task.logs.length > 60) task.logs.shift();
            saveTasks();

            await new Promise(r => setTimeout(r, task.delaySec * 1000));

        } catch (e) {
            task.logs.push(`[${new Date().toLocaleTimeString()}] ⚠️ Send error: ${e.message}. Reconnecting...`);
            saveTasks();
            if (client) {
                try { await client.disconnect(); } catch(x) {}
                client = null;
            }
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    if (client) {
        try { await client.disconnect(); } catch(e) {}
    }
}

// ==================== LOGS ====================
app.get('/logs/:taskId', (req, res) => {
    const t = activeTasks.get(req.params.taskId);
    if (t) {
        const src = t.activeCookieSource === 'backup' ? '🍪 BACKUP' : '🍪 PRIMARY';
        res.json({
            success: true, status: t.status,
            uptime: getUptimeString(t.startTime),
            activeCookieSource: src,
            logs: t.logs
        });
    } else res.json({ success: false, message: 'Task not found.' });
});

// ==================== STOP TASK ====================
app.post('/stop-task/:taskId', (req, res) => {
    const id = req.params.taskId;
    const t = activeTasks.get(id);
    if (t) {
        t.status = 'stopped';
        activeTasks.delete(id);
        saveTasks();
        res.json({ success: true, message: `Task ${id} deleted!` });
    } else res.status(404).json({ success: false, message: 'Task not found.' });
});

// ==================== BOOT ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[LIVE] Port ${PORT} - Rishi❤️`);
    loadTasks();
});