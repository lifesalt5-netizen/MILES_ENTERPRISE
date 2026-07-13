const fs = require('fs');
const path = require('path');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function csvEscape(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }
function writeCsv(file, rows, headers) {
  ensureDir(path.dirname(file));
  const lines = [headers.join(',')].concat(rows.map(r => headers.map(h => csvEscape(r[h])).join(',')));
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}
function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const txt = fs.readFileSync(file, 'utf8').trim();
  if (!txt) return [];
  const lines = txt.split(/\r?\n/);
  const headers = lines.shift().split(',').map(h => h.replace(/^"|"$/g,''));
  return lines.map(line => {
    const parts = line.match(/("(?:""|[^"])*"|[^,]*)/g).filter((_,i)=>i%2===0).map(v=>v.replace(/^"|"$/g,'').replace(/""/g,'"'));
    const o = {}; headers.forEach((h,i)=>o[h]=parts[i]||''); return o;
  });
}

class SalesOperationsService {
  constructor(root = process.cwd()) {
    this.root = root;
    this.salesDir = path.join(root, 'DATA', 'SALES');
    this.pipelineFile = path.join(this.salesDir, 'SALES_PIPELINE_MASTER.csv');
    this.activityFile = path.join(this.salesDir, 'SALES_ACTIVITY_LOG.csv');
    this.taskFile = path.join(this.salesDir, 'SALES_TASK_QUEUE.csv');
    this.reportFile = path.join(this.salesDir, 'SALES_DAILY_REPORT.json');
  }
  initialize() {
    ensureDir(this.salesDir);
    if (!fs.existsSync(this.pipelineFile)) this.seedPipeline();
    if (!fs.existsSync(this.activityFile)) writeCsv(this.activityFile, [], ['Activity ID','Date','Company','Contact','Activity Type','Summary','Owner','Next Action','Logged By']);
    this.rebuildTasks();
    return this.status();
  }
  seedPipeline() {
    const now = new Date().toISOString();
    const rows = [
      {'Opportunity ID':'OPP-001','Company':'Dreamers Inc.','Contact':'Client Team','Stage':'Proposal Delivered','Owner':'Kevin','Estimated Value':'12500','Win Probability':'60','Next Action':'Follow up on proposal status','Next Action Due':today(0),'Last Contact':today(-2),'Proposal Status':'Delivered','Proposal Due Date':'','Calendly Event':'','ORION Profile Linked':'Yes','Risk Score':'Medium','Priority':'High','Status':'Active','Last Updated':now},
      {'Opportunity ID':'OPP-002','Company':'DCS','Contact':'Client Team','Stage':'Discovery Completed','Owner':'Kevin','Estimated Value':'4000','Win Probability':'55','Next Action':'Confirm remaining deliverables and balance','Next Action Due':today(0),'Last Contact':today(-5),'Proposal Status':'Not Required','Proposal Due Date':'','Calendly Event':'','ORION Profile Linked':'Partial','Risk Score':'Medium','Priority':'High','Status':'Active','Last Updated':now},
      {'Opportunity ID':'OPP-003','Company':'SERA BRYNN LLC','Contact':'Lisa Hodde','Stage':'Qualified','Owner':'Kevin','Estimated Value':'5000','Win Probability':'40','Next Action':'Prepare GSA remediation briefing','Next Action Due':today(1),'Last Contact':today(-7),'Proposal Status':'Not Started','Proposal Due Date':'','Calendly Event':'','ORION Profile Linked':'Yes','Risk Score':'Low','Priority':'Medium','Status':'Active','Last Updated':now}
    ];
    writeCsv(this.pipelineFile, rows, ['Opportunity ID','Company','Contact','Stage','Owner','Estimated Value','Win Probability','Next Action','Next Action Due','Last Contact','Proposal Status','Proposal Due Date','Calendly Event','ORION Profile Linked','Risk Score','Priority','Status','Last Updated']);
  }
  rebuildTasks() {
    const pipeline = readCsv(this.pipelineFile);
    const tasks = [];
    const now = new Date().toISOString();
    for (const p of pipeline) {
      if ((p.Status || '').toLowerCase() !== 'active') continue;
      const due = p['Next Action Due'] || today(0);
      const priority = p.Priority || 'Medium';
      tasks.push({'Task ID':`SALES-${p['Opportunity ID']}`,'Department':'Sales Operations','Company':p.Company,'Task Type':'Follow-Up','Priority':priority,'Due Date':due,'Status':'Pending','Owner':p.Owner || 'Kevin','Action':p['Next Action'],'Created At':now,'Source Opportunity':p['Opportunity ID']});
      if ((p['Proposal Status'] || '').match(/In Progress|Draft/i)) {
        tasks.push({'Task ID':`PROPOSAL-${p['Opportunity ID']}`,'Department':'Sales Operations','Company':p.Company,'Task Type':'Proposal','Priority':'High','Due Date':p['Proposal Due Date'] || due,'Status':'Pending','Owner':'MILES','Action':'Track proposal package and prepare CEO approval before submission','Created At':now,'Source Opportunity':p['Opportunity ID']});
      }
    }
    writeCsv(this.taskFile, tasks, ['Task ID','Department','Company','Task Type','Priority','Due Date','Status','Owner','Action','Created At','Source Opportunity']);
    this.writeReport(pipeline, tasks);
    return tasks;
  }
  writeReport(pipeline, tasks) {
    const active = pipeline.filter(p => (p.Status||'').toLowerCase()==='active');
    const totalValue = active.reduce((s,p)=>s + Number(p['Estimated Value']||0),0);
    const weighted = active.reduce((s,p)=>s + Number(p['Estimated Value']||0) * Number(p['Win Probability']||0)/100,0);
    const dueToday = tasks.filter(t => isDueTodayOrPast(t['Due Date']));
    const stalled = active.filter(p => daysSince(p['Last Contact']) >= 7);
    const report = {
      generatedAt: new Date().toISOString(),
      department: 'Sales Operations',
      health: stalled.length > 2 ? 'Warning' : 'Healthy',
      activeOpportunities: active.length,
      pipelineValue: totalValue,
      weightedPipeline: Math.round(weighted),
      followUpsDue: dueToday.length,
      stalledOpportunities: stalled.length,
      proposalsInProgress: active.filter(p => /In Progress|Draft/i.test(p['Proposal Status']||'')).length,
      proposalsDelivered: active.filter(p => /Delivered/i.test(p['Proposal Status']||'')).length,
      ceoActions: dueToday.slice(0,5).map(t => `${t.Company}: ${t.Action}`),
      nextActions: tasks.slice(0,10)
    };
    fs.writeFileSync(this.reportFile, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
  status() { this.initializeFilesOnly(); return JSON.parse(fs.readFileSync(this.reportFile, 'utf8')); }
  initializeFilesOnly(){ ensureDir(this.salesDir); if(!fs.existsSync(this.pipelineFile)) this.seedPipeline(); if(!fs.existsSync(this.taskFile)) this.rebuildTasks(); if(!fs.existsSync(this.reportFile)) this.rebuildTasks(); }
  healthCheck(){ const r = this.status(); return { name:'Sales Operations', status:'active', health:r.health, activeOpportunities:r.activeOpportunities, followUpsDue:r.followUpsDue, pipelineValue:r.pipelineValue }; }
}
function today(offset=0){ const d = new Date(); d.setDate(d.getDate()+offset); return d.toISOString().slice(0,10); }
function daysSince(iso){ if(!iso) return 999; return Math.floor((new Date()-new Date(iso))/(86400000)); }
function isDueTodayOrPast(iso){ if(!iso) return true; return new Date(iso+'T23:59:59') <= new Date(); }
module.exports = SalesOperationsService;
if (require.main === module) { const svc = new SalesOperationsService(process.cwd()); console.log(JSON.stringify(svc.initialize(), null, 2)); }
