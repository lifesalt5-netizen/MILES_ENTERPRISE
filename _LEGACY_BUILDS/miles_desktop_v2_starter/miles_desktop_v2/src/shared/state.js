const state = {
  runtime: {
    status: 'stopped',
    startedAt: null,
    lastHeartbeat: null,
    restartAttempts: 0
  },
  metrics: {
    pendingTasks: 14,
    completedTasks: 8,
    failedTasks: 482,
    activeWorkers: 0,
    connectorHealth: 'unknown'
  },
  approvals: [
    {
      id: 'approval-001',
      title: 'CEO approval queue initialized',
      type: 'system',
      status: 'pending',
      createdAt: new Date().toISOString()
    }
  ],
  notifications: [
    {
      id: 'note-001',
      severity: 'info',
      message: 'MILES Desktop v2 initialized.',
      createdAt: new Date().toISOString()
    }
  ],
  workers: [],
  tasks: []
};

function snapshot() {
  return JSON.parse(JSON.stringify(state));
}

module.exports = { state, snapshot };
