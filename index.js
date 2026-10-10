global.WebSocket = require('ws');

const express = require('express');
const { MessengerClient, Platform, CookieManager } = require('messagix-js');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

process.on('uncaughtException', (err) => console.error('[ANTI-CRASH]', err.message));
process.on('unhandledRejection', (r) => console.error('[ANTI-CRASH]', r));

// ==================== MULTI TASK STATE ====================
const activeTasks = new Map(); // id -> task
const sseClients = new Set();   // SSE connections

function getUptimeString(startTime) {
    const diff = Date.now() - startTime;
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${d}d ${h}h ${m}m`;
}

// SSE broadcast
function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
        try { res.write(payload); } catch(e) { sseClients.delete(res); }
    }
}

// Naya log add + broadcast
function pushLog(taskId, logLine) {
    const task = activeTasks.get(taskId);
    if (!task) return;
    task.logs.push(logLine);
    if (task.logs.length > 80) task.logs.shift();
    broadcast('log', { id: taskId, line: logLine });
}

app.head('/', (req, res) => res.status(200).end());
app.get('/ping', (req, res) => res.send('Pong'));

// ==================== HTML UI ====================
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="hi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>24/7 Messenger Bot</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
<style>
body{font-family:Poppins,sans-serif;background:linear-gradient(135deg,#fff0f3,#ffe5ec);color:#2b2d42;padding:20px;margin:0;min-height:100vh}
.c{max-width:740px;margin:auto;background:#fff;padding:30px;border-radius:20px;box-shadow:0 15px 35px rgba(255,105,135,.15);border:1px solid #ffd1dc}
h2{text-align:center;margin:0 0 5px;font-size:24px}
.b{text-align:center;background:linear-gradient(135deg,#ff758c,#ff7eb3);color:#fff;display:block;padding:5px 15px;border-radius:20px;font-size:12px;font-weight:600;margin:0 auto 20px;width:fit-content}
label{font-weight:600;margin-top:15px;display:block;font-size:14px}
input,textarea{width:100%;padding:12px;margin-top:6px;border-radius:10px;border:1.5px solid #ffd1dc;background:#fff9fa;box-sizing:border-box;font-family:Poppins;font-size:14px}
textarea{height:80px;resize:vertical}
.fb{margin-top:6px;background:#fff5f7;border:1.5px dashed #ff477e;padding:12px;border-radius:10px;text-align:center;cursor:pointer}
.fb input{display:none}
.fl{color:#ff477e;font-weight:500;font-size:13px;cursor:pointer}
button{padding:14px;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-size:15px;width:100%;margin-top:15px;color:#fff}
.bs{background:linear-gradient(135deg,#ff477e,#ff1f59)}
.bt{margin-top:30px;border-top:1.5px dashed #ffd1dc;padding-top:20px}
.taskCard{background:#fff;border:1.5px solid #ffd1dc;border-radius:14px;padding:14px;margin-top:14px;box-shadow:0 4px 12px rgba(255,105,135,.08)}
.taskHeader{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}
.taskInfo{font-size:13px;color:#555;line-height:1.7;flex:1;min-width:200px}
.taskInfo b{color:#ff477e}
.grpName{font-size:15px;font-weight:700;color:#2b2d42;margin-bottom:4px}
.killBtn{background:linear-gradient(135deg,#111827,#dc2626);color:#fff;border:none;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;white-space:nowrap;width:auto;margin:0;letter-spacing:.5px}
.killBtn:hover{background:linear-gradient(135deg,#dc2626,#991b1b)}
.logs{background:#0d1117;color:#4ade80;padding:12px;border-radius:10px;height:180px;overflow-y:auto;font-family:'Courier New',monospace;font-size:12px;margin-top:12px;white-space:pre-wrap;line-height:1.55;border:1px solid #21262d}
.logs .sent{color:#4ade80}
.logs .ok{color:#22d3ee}
.logs .warn{color:#fbbf24}
.logs .err{color:#f87171}
.logs .info{color:#a78bfa}
.empty{text-align:center;color:#999;padding:20px;font-size:14px}
h3{text-align:center;margin:0 0 10px}
</style>
</head>
<body>
<div class="c">
<h2>⚡ 24/7 RAJ BABA OFFLINE SERVER ⚡</h2>
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

<button type="submit" class="bs">🚀 Start New Task</button>
</form>

<div class="bt">
<h3>🎮 Running Tasks</h3>
<div id="taskList"><div class="empty">Koi task nahi chal raha...</div></div>
</div>
</div>

<script>
function loadF(e){
  const f=e.target.files[0];
  if(!f)return;
  document.getElementById('fl').innerText="📄 "+f.name;
  const r=new FileReader();
  r.onload=x=>document.getElementById('mb').value=x.target.result;
  r.readAsText(f);
}

// color classify
function classifyLog(line){
  if(line.includes('🚀') || line.includes('Sent:')) return 'sent';
  if(line.includes('✅')) return 'ok';
  if(line.includes('⚠️')) return 'warn';
  if(line.includes('❌')) return 'err';
  if(line.includes('🔄') || line.includes('🔌')) return 'info';
  return '';
}

function addLogLine(taskId, line){
  const box=document.getElementById('log-'+taskId);
  if(!box) return;
  const cls=classifyLog(line);
  const span=document.createElement('div');
  span.className=cls;
  span.textContent=line;
  box.appendChild(span);
  // max 80 lines
  while(box.children.length>80) box.removeChild(box.firstChild);
  box.scrollTop=box.scrollHeight;
}

function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

function buildCard(t){
  let logHtml='';
  for(const l of (t.logs||[])){
    logHtml+='<div class="'+classifyLog(l)+'">'+esc(l)+'</div>';
  }
  return '<div class="taskCard" id="card-'+t.id+'">'
    +'<div class="taskHeader">'
      +'<div class="taskInfo">'
        +'<div class="grpName">💬 '+esc(t.groupName)+'</div>'
        +'🎯 Target: '+esc(t.threadId)+'<br>'
        +'⏱️ Uptime: '+t.uptime+' | 🍪 '+t.cookieSrc+'<br>'
        +'💬 Sent: '+t.sentCount
      +'</div>'
      +'<button class="killBtn" onclick="killTask(\''+t.id+'\')">❌ KILL TASK</button>'
    +'</div>'
    +'<div class="logs" id="log-'+t.id+'">'+logHtml+'</div>'
    +'</div>';
}

function renderTasks(tasks){
  const list=document.getElementById('taskList');
  if(!tasks || tasks.length===0){
    list.innerHTML='<div class="empty">Koi task nahi chal raha...</div>';
    return;
  }
  let html='';
  for(const t of tasks) html+=buildCard(t);
  list.innerHTML=html;
  for(const t of tasks){
    const el=document.getElementById('log-'+t.id);
    if(el) el.scrollTop=el.scrollHeight;
  }
}

document.getElementById('f').addEventListener('submit',async e=>{
  e.preventDefault();
  const fd=new FormData(e.target);
  const r=await fetch('/start-task',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(fd))});
  const j=await r.json();
  if(j.success){
    alert("✅ Task Started!");
    e.target.reset();
    document.getElementById('fl').innerText="📁 Upload Messages File";
  }else alert('❌ Error: '+j.error);
});

async function killTask(id){
  if(!confirm("☠️ Kya aap ye task KILL karna chahte ho?"))return;
  const r=await fetch('/close-task/'+id,{method:'POST'});
  const j=await r.json();
  if(j.success){
    const card=document.getElementById('card-'+id);
    if(card) card.remove();
    if(document.querySelectorAll('.taskCard').length===0){
      document.getElementById('taskList').innerHTML='<div class="empty">Koi task nahi chal raha...</div>';
    }
  }else alert(j.message);
}

// ============ SSE (Live push, NO auto refresh) ============
let evtSource=null;

function connectSSE(){
  if(evtSource) evtSource.close();
  evtSource=new EventSource('/events');

  evtSource.addEventListener('init', e=>{
    const data=JSON.parse(e.data);
    renderTasks(data.tasks);
  });

  evtSource.addEventListener('log', e=>{
    const data=JSON.parse(e.data);
    addLogLine(data.id, data.line);
  });

  evtSource.addEventListener('stats', e=>{
    const data=JSON.parse(e.data);
    // update uptime + sent count live (no full refresh)
    const info=document.querySelector('#card-'+data.id+' .taskInfo');
    if(info){
      info.innerHTML=
        '<div class="grpName">💬 '+esc(data.groupName)+'</div>'
        +'🎯 Target: '+esc(data.threadId)+'<br>'
        +'⏱️ Uptime: '+data.uptime+' | 🍪 '+data.cookieSrc+'<br>'
        +'💬 Sent: '+data.sentCount;
    }
  });

  evtSource.addEventListener('newtask', e=>{
    const data=JSON.parse(e.data);
    const list=document.getElementById('taskList');
    if(list.querySelector('.empty')) list.innerHTML='';
    if(!document.getElementById('card-'+data.id)){
      list.insertAdjacentHTML('beforeend', buildCard(data.task));
      const el=document.getElementById('log-'+data.id);
      if(el) el.scrollTop=el.scrollHeight;
    }
  });

  evtSource.onerror=()=>{
    // reconnect after 3s
    setTimeout(connectSSE, 3000);
  };
}

connectSSE();
</script>
</body>
</html>`);
});

// ==================== SSE ENDPOINT ====================
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    sseClients.add(res);

    // Init: bhejo saare current tasks
    const tasks = [];
    for (const [id, t] of activeTasks.entries()) {
        if (t.status !== 'running') continue;
        tasks.push({
            id,
            threadId: t.threadId,
            groupName: t.groupName || t.threadId,
            uptime: getUptimeString(t.startTime),
            cookieSrc: t.activeCookieSource === 'backup' ? 'BACKUP' : 'PRIMARY',
            sentCount: t.sentCount,
            logs: t.logs.slice(-80)
        });
    }
    res.write(`event: init\ndata: ${JSON.stringify({ tasks })}\n\n`);

    // heartbeat
    const hb = setInterval(() => {
        try { res.write(': ping\n\n'); } catch(e) {}
    }, 20000);

    req.on('close', () => {
        clearInterval(hb);
        sseClients.delete(res);
    });
});

// ==================== START TASK ====================
app.post('/start-task', async (req, res) => {
    const { cookies, backupCookies, threadId, hatersName, messages, delay } = req.body;
    const taskId = crypto.randomBytes(3).toString('hex');
    const messageList = messages.split('\n').map(m => m.trim()).filter(Boolean);

    const task = {
        cookies, backupCookies: (backupCookies || '').trim(),
        threadId, hatersName, messages: messageList,
        delaySec: parseInt(delay) || 10,
        logs: [],
        status: 'running',
        startTime: Date.now(),
        activeCookieSource: 'primary',
        sentCount: 0,
        killFlag: false,
        groupName: threadId // fallback
    };

    activeTasks.set(taskId, task);
    pushLog(taskId, `[${new Date().toLocaleTimeString()}] ✅ Task started.`);
    if (task.backupCookies) pushLog(taskId, `[${new Date().toLocaleTimeString()}] 🛡️ Backup cookies enabled.`);

    // Turant card bhejo (group name abhi fallback hai)
    broadcast('newtask', {
        id: taskId,
        task: {
            id: taskId, threadId, groupName: threadId,
            uptime: '0d 0h 0m', cookieSrc: 'PRIMARY',
            sentCount: 0, logs: task.logs.slice(-80)
        }
    });

    res.json({ success: true });

    runTask(taskId);
});

// ==================== CLOSE TASK ====================
app.post('/close-task/:taskId', (req, res) => {
    const id = req.params.taskId;
    const t = activeTasks.get(id);
    if (t) {
        t.killFlag = true;
        t.status = 'killed';
        activeTasks.delete(id);
        res.json({ success: true, message: `☠️ Task killed!` });
    } else {
        res.json({ success: false, message: 'Task already killed.' });
    }
});

// ==========================================
// 🚀 TASK RUNNER
// ==========================================
async function runTask(taskId) {
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

        // Try to fetch group name
        try {
            if (nc.api && typeof nc.api.getThreadInfo === 'function') {
                const info = await nc.api.getThreadInfo(task.threadId);
                if (info && info.name) {
                    task.groupName = info.name;
                } else if (info && info.threadName) {
                    task.groupName = info.threadName;
                }
            } else if (nc.api && typeof nc.api.getThread === 'function') {
                const info = await nc.api.getThread(task.threadId);
                if (info && (info.name || info.threadName)) {
                    task.groupName = info.name || info.threadName;
                }
            }
        } catch(e) { /* ignore, fallback rahega */ }

        return nc;
    }

    while (true) {
        // 🔴 KILL CHECK
        if (!activeTasks.has(taskId) || task.killFlag || task.status !== 'running') {
            console.log(`[KILLED] Task exiting.`);
            if (client) { try { await client.disconnect(); } catch(e) {} }
            return;
        }

        // ========== CONNECT IF NEEDED ==========
        if (!client) {
            let connected = false;

            for (let i = 1; i <= 3; i++) {
                if (task.killFlag || !activeTasks.has(taskId)) return;
                try {
                    pushLog(taskId, `[${new Date().toLocaleTimeString()}] 🔌 [PRIMARY] Attempt ${i}/3...`);
                    client = await doConnect(task.cookies);
                    task.activeCookieSource = 'primary';
                    pushLog(taskId, `[${new Date().toLocaleTimeString()}] ✅ Primary connected!`);
                    connected = true;
                    break;
                } catch (e) {
                    pushLog(taskId, `[${new Date().toLocaleTimeString()}] ⚠️ Primary ${i}/3 failed: ${e.message}`);
                    if (i < 3) await new Promise(r => setTimeout(r, 5000));
                }
            }

            if (!connected && task.backupCookies && task.backupCookies.trim()) {
                pushLog(taskId, `[${new Date().toLocaleTimeString()}] 🔄 Primary fail. Backup try...`);
                for (let i = 1; i <= 2; i++) {
                    if (task.killFlag || !activeTasks.has(taskId)) return;
                    try {
                        pushLog(taskId, `[${new Date().toLocaleTimeString()}] 🔌 [BACKUP] Attempt ${i}/2...`);
                        client = await doConnect(task.backupCookies);
                        task.activeCookieSource = 'backup';
                        pushLog(taskId, `[${new Date().toLocaleTimeString()}] ✅ Backup connected!`);
                        connected = true;
                        break;
                    } catch (e) {
                        pushLog(taskId, `[${new Date().toLocaleTimeString()}] ⚠️ Backup ${i}/2 failed: ${e.message}`);
                        if (i < 2) await new Promise(r => setTimeout(r, 5000));
                    }
                }
            }

            if (!connected) {
                pushLog(taskId, `[${new Date().toLocaleTimeString()}] ❌ Saare attempts fail. 60s wait...`);
                task.activeCookieSource = 'primary';
                for (let w = 0; w < 12; w++) {
                    if (task.killFlag || !activeTasks.has(taskId)) return;
                    await new Promise(r => setTimeout(r, 5000));
                }
                continue;
            }
        }

        // ========== SEND MESSAGE ==========
        const rawMsg = task.messages[msgIndex];
        const finalMessage = task.hatersName ? `${task.hatersName} ${rawMsg}` : rawMsg;

        try {
            await client.sendMessage(task.threadId, finalMessage);
            pushLog(taskId, `[${new Date().toLocaleTimeString()}] 🚀 [${task.activeCookieSource.toUpperCase()}] Sent: ${finalMessage}`);
            task.sentCount++;

            msgIndex++;
            if (msgIndex >= task.messages.length) {
                msgIndex = 0;
                loopCount++;
                pushLog(taskId, `[${new Date().toLocaleTimeString()}] 🔄 Round ${loopCount} started...`);
            }

            const totalWait = task.delaySec * 1000;
            const steps = Math.ceil(totalWait / 500);
            for (let s = 0; s < steps; s++) {
                if (task.killFlag || !activeTasks.has(taskId)) {
                    if (client) { try { await client.disconnect(); } catch(e) {} }
                    return;
                }
                await new Promise(r => setTimeout(r, Math.min(500, totalWait - s * 500)));
            }

        } catch (e) {
            pushLog(taskId, `[${new Date().toLocaleTimeString()}] ⚠️ Send error: ${e.message}. Reconnecting...`);
            if (client) {
                try { await client.disconnect(); } catch(x) {}
                client = null;
            }
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

// ==================== UPTIME UPDATER (Stats push har 5s) ====================
setInterval(() => {
    for (const [id, t] of activeTasks.entries()) {
        if (t.status !== 'running') continue;
        broadcast('stats', {
            id,
            threadId: t.threadId,
            groupName: t.groupName || t.threadId,
            uptime: getUptimeString(t.startTime),
            cookieSrc: t.activeCookieSource === 'backup' ? 'BACKUP' : 'PRIMARY',
            sentCount: t.sentCount
        });
    }
}, 5000);

// ==================== BOOT ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[LIVE] Port ${PORT} - The Legend Raj BaBa`);
    console.log('[INFO] Live logs via SSE. KILL button per task.');
});