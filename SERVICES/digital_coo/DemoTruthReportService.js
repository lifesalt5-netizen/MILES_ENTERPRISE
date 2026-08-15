'use strict';

const fs = require('fs');
const path = require('path');
const DepartmentDashboardService = require('./DepartmentDashboardService');

function now() { return new Date().toISOString(); }
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function synthetic(item = {}) {
  const text = [item.id,item.name,item.company,item.contactName,item.email,item.source]
    .filter(Boolean).join(' ').toLowerCase();
  return /build[ _-]?e010|test company|example\.com|unknown target/.test(text);
}
function newestJson(dir, prefix) {
  try {
    return fs.readdirSync(dir)
      .filter(n => n.startsWith(prefix) && n.endsWith('.json'))
      .map(n => ({ file: path.join(dir,n), mtimeMs: fs.statSync(path.join(dir,n)).mtimeMs }))
      .sort((a,b)=>b.mtimeMs-a.mtimeMs)[0] || null;
  } catch { return null; }
}
function statusCounts(items) {
  const counts = { queued:0,running:0,completed:0,failed:0,awaitingApproval:0,other:0 };
  for (const item of Array.isArray(items) ? items : []) {
    const s = String(item?.status || '').toUpperCase();
    if (/AWAITING|APPROVAL/.test(s)) counts.awaitingApproval++;
    else if (/RUNNING|IN_PROGRESS|EXECUTING|DISPATCHED/.test(s)) counts.running++;
    else if (/READY|QUEUED|PENDING|AUTHORIZED/.test(s)) counts.queued++;
    else if (/COMPLETE|SUCCESS|SUCCEEDED/.test(s)) counts.completed++;
    else if (/FAIL|ERROR|BLOCKED/.test(s)) counts.failed++;
    else counts.other++;
  }
  return counts;
}

class DemoTruthReportService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname,'..','..');
    this.outDir = path.join(this.rootDir,'DATA','demo_truth');
    this.departmentDashboard = options.departmentDashboard || new DepartmentDashboardService({ rootDir:this.rootDir });
  }

  async snapshot() {
    const runtimeDir = path.join(this.rootDir,'DATA','runtime');
    const dealsFile = path.join(runtimeDir,'latest_deals.json');
    const dealsState = readJson(dealsFile,{deals:[]}) || {deals:[]};
    const deals = (Array.isArray(dealsState.deals)?dealsState.deals:[])
      .filter(d=>!synthetic(d))
      .filter(d=>String(d.status||'ACTIVE').toUpperCase()==='ACTIVE');

    const taskFile = path.join(runtimeDir,'task_queue.json');
    const tasksRaw = readJson(taskFile,[]);
    const tasks = Array.isArray(tasksRaw) ? tasksRaw : [];

    const salesNewest = newestJson(path.join(this.rootDir,'DATA','sales_coo'),'pipeline_review_');
    const sales = salesNewest ? readJson(salesNewest.file,{}) : {};
    const salesOutputs = Array.isArray(sales?.analysis?.outputs) ? sales.analysis.outputs.filter(r=>!synthetic(r?.deal||{})) : [];
    const salesRecommendations = Array.isArray(sales?.recommendations)
      ? sales.recommendations.filter(r=>!synthetic({name:[r.dealName,r.reason,r.action].filter(Boolean).join(' ')}))
      : [];

    const orionFile = path.join(this.rootDir,'DATA','orion_coo','latest_orion_operation.json');
    const orion = readJson(orionFile,{}) || {};
    const intelligence = orion.intelligence || {};
    const orionCounts = {
      contractors: Number(orion?.metrics?.contractors ?? (Array.isArray(intelligence.contractors)?intelligence.contractors.length:0)),
      buyers: Number(orion?.metrics?.buyers ?? (Array.isArray(intelligence.buyers)?intelligence.buyers.length:0)),
      opportunities: Number(orion?.metrics?.opportunities ?? (Array.isArray(intelligence.opportunities)?intelligence.opportunities.length:0)),
      recompetes: Number(orion?.metrics?.recompetes ?? (Array.isArray(intelligence.recompetes)?intelligence.recompetes.length:0)),
      recommendations: Number(orion?.metrics?.recommendations ?? (Array.isArray(intelligence.recommendationRecords)?intelligence.recommendationRecords.length:0))
    };

    const workforceDir = path.join(this.rootDir,'DATA','workforce_results');
    let workforce = [];
    try {
      workforce = fs.readdirSync(workforceDir)
        .filter(n=>n.endsWith('.json'))
        .map(n=>({file:path.join(workforceDir,n),mtimeMs:fs.statSync(path.join(workforceDir,n)).mtimeMs}))
        .sort((a,b)=>b.mtimeMs-a.mtimeMs)
        .slice(0,25)
        .map(x=>({file:x.file,data:readJson(x.file,null),mtimeMs:x.mtimeMs}))
        .filter(x=>x.data)
        .map(x=>({taskId:x.data.taskId||null,objective:x.data.objective||x.data.action||'',department:x.data.department||'',provider:x.data.provider||'',status:x.data.ok===false?'FAILED':'COMPLETED',createdAt:x.data.createdAt||new Date(x.mtimeMs).toISOString(),file:x.file}));
    } catch {}

    const memoryFile = path.join(this.rootDir,'DATA','runtime_guardian','worker_memory_latest.json');
    const memory = readJson(memoryFile,null);
    const guardianDir = path.join(this.rootDir,'DATA','runtime_guardian');
    const guardianNewest = newestJson(guardianDir,'guardian_');
    const guardian = guardianNewest ? readJson(guardianNewest.file,null) : null;

    const departments = await this.departmentDashboard.snapshot();
    const pipelineValue = deals.reduce((n,d)=>n+Number(d.value||0),0);
    const weightedForecast = deals.reduce((n,d)=>n+Number(d.weightedValue||0),0);

    const truth = {
      ok:true,
      type:'MILES_DEMO_TRUTH',
      generatedAt:now(),
      readOnly:true,
      headline:{
        activeRealDeals:deals.length,
        pipelineValue,
        weightedForecast,
        taskQueue:statusCounts(tasks),
        workforceResultsVisible:workforce.length,
        departmentStatus:departments.status,
        orionStatus:orion.status||'UNKNOWN',
        workerMemoryMB:memory?.rssMb ?? null
      },
      revenue:{
        source:dealsFile,
        generatedAt:dealsState.generatedAt||null,
        deals,
        pipelineValue,
        weightedForecast,
        latestSalesReview:salesNewest?.file||null,
        salesMetrics:sales?.metrics||{},
        salesOutputs,
        recommendations:salesRecommendations
      },
      execution:{
        taskQueueSource:taskFile,
        counts:statusCounts(tasks),
        recentTasks:tasks.slice(-25).reverse(),
        recentWorkforceResults:workforce
      },
      departments,
      orion:{
        source:orionFile,
        generatedAt:orion.generatedAt||null,
        status:orion.status||'UNKNOWN',
        counts:orionCounts,
        exceptions:Array.isArray(orion.exceptions)?orion.exceptions.slice(0,10):[]
      },
      runtime:{
        workerMemory:memory,
        latestGuardian:guardian,
        guardianReport:guardianNewest?.file||null
      },
      truthRules:[
        'Synthetic BUILD/test/example.com/Unknown Target deals are excluded.',
        'latest_deals.json is current P2GC deal truth.',
        'Sales COO recommendations enrich current deal truth.',
        'TaskQueue + workforce_results are execution truth.',
        'ORION is growth intelligence, not a substitute for current deal truth.'
      ]
    };

    ensureDir(this.outDir);
    fs.writeFileSync(path.join(this.outDir,'miles_demo_truth_latest.json'),JSON.stringify(truth,null,2),'utf8');
    fs.writeFileSync(path.join(this.outDir,'miles_demo_truth_latest.md'),this.renderMarkdown(truth),'utf8');
    fs.writeFileSync(path.join(this.outDir,'miles_demo_truth_latest.html'),this.renderHtml(truth),'utf8');
    return truth;
  }

  renderMarkdown(t) {
    const dealLines = t.revenue.deals.map(d=>`- ${d.company||d.name}: $${Number(d.value||0).toLocaleString()} | stage ${d.stage||'UNKNOWN'} | action ${d.action||'—'}`).join('\n') || '- None';
    const deptLines = (t.departments.departments||[]).map(d=>`- ${d.name}: ${d.status} | running ${d.runningCount||0} | queued ${d.queueCount||0} | failed ${d.failedCount||0}`).join('\n');
    return `# MILES Demo Truth Report\n\nGenerated: ${t.generatedAt}\n\n## Revenue\n\nActive real deals: ${t.headline.activeRealDeals}  \nPipeline: $${t.headline.pipelineValue.toLocaleString()}  \nWeighted forecast: $${t.headline.weightedForecast.toLocaleString()}\n\n${dealLines}\n\n## Execution\n\nQueued: ${t.execution.counts.queued}  \nRunning: ${t.execution.counts.running}  \nCompleted: ${t.execution.counts.completed}  \nFailed: ${t.execution.counts.failed}  \nAwaiting approval: ${t.execution.counts.awaitingApproval}\n\n## Departments\n\n${deptLines}\n\n## ORION\n\nStatus: ${t.orion.status}  \nContractors: ${t.orion.counts.contractors}  \nBuyers: ${t.orion.counts.buyers}  \nOpportunities: ${t.orion.counts.opportunities}  \nRecompetes: ${t.orion.counts.recompetes}\n\n## Runtime\n\nWorker RAM MB: ${t.headline.workerMemoryMB ?? 'unknown'}\n`;
  }

  renderHtml(t) {
    const deals = t.revenue.deals.map(d=>`<tr><td>${esc(d.company||d.name)}</td><td>$${esc(Number(d.value||0).toLocaleString())}</td><td>${esc(d.stage)}</td><td>${esc(d.action||'')}</td></tr>`).join('') || '<tr><td colspan="4">No active real deals.</td></tr>';
    const departments = (t.departments.departments||[]).map(d=>`<tr><td>${esc(d.name)}</td><td>${esc(d.status)}</td><td>${esc(d.health)}</td><td>${d.runningCount||0}</td><td>${d.queueCount||0}</td><td>${d.completedCount||0}</td><td>${d.failedCount||0}</td></tr>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MILES Demo Truth</title><style>body{font-family:Segoe UI,Arial;background:#0f172a;color:#f8fafc;margin:0;padding:24px}h1,h2{margin:0 0 14px}.muted{color:#94a3b8}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:18px 0}.card,section{background:#111827;border:1px solid #334155;border-radius:14px;padding:16px;margin-bottom:16px}.big{font-size:28px;font-weight:700}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #334155;padding:8px;text-align:left}th{color:#94a3b8}</style></head><body><h1>MILES Demo Truth</h1><div class="muted">Generated ${esc(t.generatedAt)} · canonical read-only report</div><div class="grid"><div class="card"><div class="muted">Active Real Deals</div><div class="big">${t.headline.activeRealDeals}</div></div><div class="card"><div class="muted">Pipeline</div><div class="big">$${esc(t.headline.pipelineValue.toLocaleString())}</div></div><div class="card"><div class="muted">Weighted Forecast</div><div class="big">$${esc(t.headline.weightedForecast.toLocaleString())}</div></div><div class="card"><div class="muted">Department Health</div><div class="big">${esc(t.headline.departmentStatus)}</div></div><div class="card"><div class="muted">Worker RAM</div><div class="big">${esc(t.headline.workerMemoryMB ?? '—')} MB</div></div></div><section><h2>Revenue Truth</h2><table><tr><th>Company</th><th>Value</th><th>Stage</th><th>Action</th></tr>${deals}</table></section><section><h2>Departments</h2><table><tr><th>Department</th><th>Status</th><th>Health</th><th>Running</th><th>Queued</th><th>Completed</th><th>Failed</th></tr>${departments}</table></section><section><h2>ORION</h2><div>Contractors ${t.orion.counts.contractors} · Buyers ${t.orion.counts.buyers} · Opportunities ${t.orion.counts.opportunities} · Recompetes ${t.orion.counts.recompetes}</div></section></body></html>`;
  }
}

module.exports = DemoTruthReportService;
module.exports.DemoTruthReportService = DemoTruthReportService;
