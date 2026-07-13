const $ = id => document.getElementById(id);
function card(label, value){return `<div class="card"><span class="muted">${label}</span><strong>${value}</strong></div>`}
function row(a,b,c=''){return `<div class="row"><span>${a}</span><span>${b}</span><span class="muted">${c}</span></div>`}
async function refresh(){
  const s = await window.miles.status();
  $('kpis').innerHTML = card('Runtime', s.running?'Running':'Stopped') + card('Ticks', s.tickCount) + card('Pending', s.tasks.pending) + card('Completed', s.tasks.completed) + card('Approvals', s.approvals.filter(a=>a.status==='waiting').length) + card('Alerts', s.notifications.length);
  $('connectors').innerHTML = s.connectors.map(c=>row(c.name, c.healthy?'<span class="ok">Healthy</span>':'<span class="bad">Down</span>', c.mode)).join('');
  $('workers').innerHTML = s.workers.map(w=>row(w.id, `<span class="pill">${w.status}</span>`, w.role)).join('');
  $('tasks').innerHTML = s.tasks.tasks.map(t=>row(t.title, `<span class="pill">${t.status}</span>`, t.area)).join('') || '<p class="muted">No tasks.</p>';
  $('approvals').innerHTML = s.approvals.map(a=>`<div class="row"><span>${a.title}</span><span>${a.status}</span><span><button onclick="decide('${a.id}','approved')">Approve</button><button onclick="decide('${a.id}','rejected')">Reject</button></span></div>`).join('') || '<p class="muted">No approvals waiting.</p>';
  $('notifications').innerHTML = s.notifications.slice(0,10).map(n=>row(n.title, n.priority, new Date(n.ts).toLocaleTimeString())).join('') || '<p class="muted">No notifications.</p>';
}
async function decide(id, d){ await window.miles.decideApproval(id,d); refresh(); }
window.decide = decide;
$('start').onclick=async()=>{await window.miles.start(); refresh();}; $('stop').onclick=async()=>{await window.miles.stop(); refresh();}; $('restart').onclick=async()=>{await window.miles.restart(); refresh();};
$('chatForm').onsubmit=async e=>{e.preventDefault(); const input=$('chatInput'); const msg=input.value.trim(); if(!msg)return; $('chatLog').innerHTML += `<div class="msg"><b>Kevin:</b> ${msg}</div>`; input.value=''; const res=await window.miles.command(msg); $('chatLog').innerHTML += `<div class="msg"><b>MILES:</b> ${res.text}</div>`; refresh();};
refresh(); setInterval(refresh, 5000);
