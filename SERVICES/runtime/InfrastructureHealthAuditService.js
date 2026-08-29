'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');

function pct(n, d) { return d > 0 ? Math.round((n / d) * 10000) / 100 : null; }
function bytesGb(n) { return Math.round((Number(n || 0) / (1024 ** 3)) * 100) / 100; }
function nowIso() { return new Date().toISOString(); }
function runReadOnly(command, args, cwd) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout?.on('data', d => { stdout += d.toString(); });
    child.stderr?.on('data', d => { stderr += d.toString(); });
    child.once('error', error => resolve({ ok:false, code:-1, stdout, stderr:`${stderr}\n${error.message}`.trim() }));
    child.once('close', code => resolve({ ok:code === 0, code, stdout:stdout.trim(), stderr:stderr.trim() }));
  });
}
function tcpCheck(host, port, timeoutMs = 3000) {
  return new Promise(resolve => {
    const started = Date.now();
    const socket = net.createConnection({ host, port:Number(port) });
    let done = false;
    const finish = (ok, error = null) => {
      if (done) return; done = true;
      try { socket.destroy(); } catch {}
      resolve({ host, port:Number(port), ok, latencyMs:Date.now()-started, error:error ? String(error.message || error) : null });
    };
    socket.setTimeout(timeoutMs, () => finish(false, 'TIMEOUT'));
    socket.once('connect', () => finish(true));
    socket.once('error', error => finish(false, error));
  });
}

class InfrastructureHealthAuditService {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.env.MILES_ROOT || process.cwd());
    this.runtimeDir = path.join(this.root, 'DATA', 'runtime', 'infrastructure_health');
    this.latestFile = path.join(this.runtimeDir, 'latest.json');
    this.intervalHours = Math.max(1, Number(options.intervalHours || process.env.MILES_INFRA_HEALTH_INTERVAL_HOURS || 72));
  }

  lastRun() {
    try { return JSON.parse(fs.readFileSync(this.latestFile, 'utf8')); }
    catch { return null; }
  }
  due(now = Date.now()) {
    const prior = this.lastRun();
    const at = Date.parse(prior?.observedAt || prior?.finishedAt || '');
    if (!Number.isFinite(at)) return { due:true, reason:'NO_PRIOR_AUDIT', ageHours:null };
    const ageHours = (now - at) / 3600000;
    return { due:ageHours >= this.intervalHours, reason:ageHours >= this.intervalHours ? 'AGE_THRESHOLD_REACHED' : 'WITHIN_INTERVAL', ageHours:Math.round(ageHours*100)/100 };
  }

  memory() {
    const total = os.totalmem(), free = os.freemem(), used = Math.max(0,total-free);
    return { totalGb:bytesGb(total), usedGb:bytesGb(used), freeGb:bytesGb(free), usedPct:pct(used,total) };
  }
  cpu() {
    const cpus = os.cpus() || [];
    const load = os.loadavg();
    return { logicalCpus:cpus.length, model:cpus[0]?.model || null, speedMhz:cpus[0]?.speed || null, load1m:load[0], load5m:load[1], load15m:load[2], uptimeSeconds:Math.round(os.uptime()) };
  }
  disks() {
    const roots = [...new Set([path.parse(this.root).root, process.env.MILES_INTELLIGENCE_ROOT ? path.parse(process.env.MILES_INTELLIGENCE_ROOT).root : null].filter(Boolean))];
    return roots.map(root => {
      try {
        if (typeof fs.statfsSync !== 'function') return { root, ok:false, error:'STATFS_UNAVAILABLE' };
        const s = fs.statfsSync(root);
        const total = Number(s.blocks) * Number(s.bsize);
        const free = Number(s.bavail) * Number(s.bsize);
        const used = Math.max(0,total-free);
        return { root, ok:true, totalGb:bytesGb(total), usedGb:bytesGb(used), freeGb:bytesGb(free), usedPct:pct(used,total) };
      } catch (error) { return { root, ok:false, error:error.message }; }
    });
  }
  recommendations(snapshot) {
    const out = [];
    if (snapshot.memory.usedPct >= 90) out.push({ type:'MEMORY_PRESSURE', recommendation:'Review high-memory processes and consolidate only after CEO review.', expectedBenefit:'Reduce memory pressure and swap risk', risk:'Stopping a required service could interrupt production', rollback:'Do not stop/remove anything during this audit; preserve process inventory first.' });
    for (const disk of snapshot.disks.filter(x=>x.ok && x.usedPct >= 85)) out.push({ type:'STORAGE_PRESSURE', target:disk.root, recommendation:'Review large/archive/duplicate/runtime artifacts for consolidation or archival before any removal.', expectedBenefit:'Restore free storage headroom', risk:'Deleting required evidence or data could break audits/recovery', rollback:'No deletion occurs; retain or back up candidate artifacts before approved action.' });
    if (snapshot.runtime?.pm2?.ok === false) out.push({ type:'PROCESS_MANAGER_VISIBILITY', recommendation:'Repair PM2 visibility/process ownership without CEO shell dependency.', expectedBenefit:'Restore supervised runtime truth', risk:'Incorrect restart could interrupt services', rollback:'Preserve current process state and logs before any restart.' });
    if ((snapshot.network || []).some(x=>!x.ok)) out.push({ type:'DEPENDENCY_REACHABILITY', recommendation:'Investigate unreachable dependency before changing credentials/DNS/configuration.', expectedBenefit:'Restore external dependency availability', risk:'Speculative provider changes can worsen delivery', rollback:'Read-only diagnosis first; no provider mutation from this audit.' });
    return out;
  }

  async runtime() {
    const git = await runReadOnly('git', ['status','--porcelain=v1'], this.root);
    const pm2Command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'pm2';
    const pm2Args = process.platform === 'win32' ? ['/d','/s','/c','pm2','jlist'] : ['jlist'];
    const pm2 = await runReadOnly(pm2Command, pm2Args, this.root);
    let pm2Apps = [];
    if (pm2.ok) { try { pm2Apps = JSON.parse(pm2.stdout || '[]').map(x=>({ name:x.name, pid:x.pid, status:x.pm2_env?.status || null, restarts:x.pm2_env?.restart_time ?? null, memoryBytes:x.monit?.memory ?? null, cpuPct:x.monit?.cpu ?? null })); } catch {} }
    const evidence = path.join(this.root,'DATA','runtime','remote_execution_bridge_evidence.json');
    const supervisor = path.join(this.root,'DATA','runtime','remote_execution_bridge_supervisor.json');
    return {
      git:{ ok:git.ok, trackedSourceDrift:git.ok ? git.stdout.split(/\r?\n/).filter(Boolean).slice(0,200) : [], error:git.ok?null:git.stderr },
      pm2:{ ok:pm2.ok, apps:pm2Apps, error:pm2.ok?null:pm2.stderr },
      bridgeEvidenceFile:{ exists:fs.existsSync(evidence), modifiedAt:fs.existsSync(evidence)?fs.statSync(evidence).mtime.toISOString():null },
      bridgeSupervisorFile:{ exists:fs.existsSync(supervisor), modifiedAt:fs.existsSync(supervisor)?fs.statSync(supervisor).mtime.toISOString():null }
    };
  }

  async run() {
    const startedAt = nowIso();
    const endpoints = [
      ['localhost', Number(process.env.MILES_PORT || 3737)],
      ['localhost', Number(process.env.MILES_UNIFIED_GATEWAY_PORT || 8787)],
      ['api.instantly.ai', 443],
      ['api.calendly.com', 443],
      ['imap.ionos.com', 993],
      ['github.com', 443]
    ];
    const snapshot = { memory:this.memory(), cpu:this.cpu(), disks:this.disks(), runtime:await this.runtime(), network:[] };
    for (const [host,port] of endpoints) snapshot.network.push(await tcpCheck(host,port));
    const recommendations = this.recommendations(snapshot);
    const hardProblems = [
      snapshot.memory.usedPct >= 97,
      snapshot.disks.some(x=>x.ok && x.usedPct >= 95),
      snapshot.runtime.git.ok === false,
      snapshot.runtime.pm2.ok === false,
      snapshot.network.filter(x=>x.host !== 'localhost').some(x=>!x.ok)
    ].filter(Boolean).length;
    const result = {
      ok:hardProblems === 0,
      service:'MILES_INFRASTRUCTURE_HEALTH_AUDIT',
      mode:'READ_ONLY_RECOMMENDATION_ONLY',
      startedAt,
      observedAt:nowIso(),
      intervalHours:this.intervalHours,
      snapshot,
      recommendations,
      safety:{ destructiveActionsPerformed:false, filesDeleted:false, servicesStopped:false, appsUninstalled:false, dataConsolidated:false, recommendationsRequireCEOReviewBeforeDestructiveAction:true }
    };
    fs.mkdirSync(this.runtimeDir,{recursive:true});
    fs.writeFileSync(this.latestFile,JSON.stringify(result,null,2),'utf8');
    return result;
  }
}

module.exports = InfrastructureHealthAuditService;
module.exports.helpers = { pct, bytesGb, tcpCheck };