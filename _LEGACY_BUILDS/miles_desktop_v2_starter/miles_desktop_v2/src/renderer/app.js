let currentState = null;

const viewTitles = {
  ceo: 'CEO Dashboard',
  chat: 'Executive Chat',
  runtime: 'Runtime Dashboard',
  workers: 'Worker Dashboard',
  engineering: 'Engineering Dashboard',
  tasks: 'Task Dashboard',
  approvals: 'Approval Queue',
  notifications: 'Notification Center'
};

function item(text) {
  const li = document.createElement('li');
  li.textContent = text;
  return li;
}

function render(state) {
  currentState = state;
  document.getElementById('runtime-line').textContent = `Runtime: ${state.runtime.status} | Last heartbeat: ${state.runtime.lastHeartbeat || 'none'}`;
  document.getElementById('pendingTasks').textContent = state.metrics.pendingTasks;
  document.getElementById('completedTasks').textContent = state.metrics.completedTasks;
  document.getElementById('failedTasks').textContent = state.metrics.failedTasks;
  document.getElementById('activeWorkers').textContent = state.metrics.activeWorkers;
  document.getElementById('runtimeJson').textContent = JSON.stringify(state.runtime, null, 2);

  const ceoAttention = document.getElementById('ceoAttention');
  ceoAttention.innerHTML = '';
  state.approvals.slice(0, 6).forEach(a => ceoAttention.appendChild(item(`${a.title} (${a.status})`)));

  const taskList = document.getElementById('taskList');
  taskList.innerHTML = '';
  state.tasks.forEach(t => taskList.appendChild(item(`${t.title} — ${t.status}`)));

  const approvalList = document.getElementById('approvalList');
  approvalList.innerHTML = '';
  state.approvals.forEach(a => approvalList.appendChild(item(`${a.title} — ${a.type} — ${a.status}`)));

  const notificationList = document.getElementById('notificationList');
  notificationList.innerHTML = '';
  state.notifications.forEach(n => notificationList.appendChild(item(`${n.severity.toUpperCase()}: ${n.message}`)));

  const workersList = document.getElementById('workersList');
  workersList.innerHTML = '';
  ['Discovery Worker', 'Execution Worker', 'Engineering Worker'].forEach(w => workersList.appendChild(item(`${w} — ${state.runtime.status === 'running' ? 'online' : 'offline'}`)));
}

async function refresh() {
  render(await window.miles.getState());
}

function switchView(view) {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.getElementById('page-title').textContent = viewTitles[view];
}

document.querySelectorAll('nav button').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
document.getElementById('start-runtime').addEventListener('click', async () => { await window.miles.startRuntime(); await refresh(); });
document.getElementById('stop-runtime').addEventListener('click', async () => { await window.miles.stopRuntime(); await refresh(); });
document.getElementById('restart-runtime').addEventListener('click', async () => { await window.miles.restartRuntime(); await refresh(); });

document.getElementById('sendCommand').addEventListener('click', async () => {
  const input = document.getElementById('commandInput');
  const text = input.value.trim();
  if (!text) return;
  const chatLog = document.getElementById('chatLog');
  const userMessage = document.createElement('div');
  userMessage.className = 'message user';
  userMessage.textContent = text;
  chatLog.appendChild(userMessage);
  const task = await window.miles.executeCommand(text);
  const milesMessage = document.createElement('div');
  milesMessage.className = 'message miles';
  milesMessage.textContent = `Queued: ${task.title}`;
  chatLog.appendChild(milesMessage);
  input.value = '';
  await refresh();
});

refresh();
setInterval(refresh, 5000);
