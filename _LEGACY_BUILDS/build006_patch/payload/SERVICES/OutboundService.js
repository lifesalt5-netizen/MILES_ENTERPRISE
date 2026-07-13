const fs = require('fs');
const path = require('path');

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }
function csvEscape(v){ const s = String(v ?? ''); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }
function writeCsv(file, rows, headers){
  ensureDir(path.dirname(file));
  const out = [headers.join(',')].concat(rows.map(r => headers.map(h => csvEscape(r[h])).join(','))).join('\n');
  fs.writeFileSync(file,out,'utf8');
}
function readCsv(file){
  if(!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file,'utf8').trim();
  if(!text) return [];
  const lines = text.split(/\r?\n/);
  const headers = lines.shift().split(',');
  return lines.map(line => {
    const vals = parseCsvLine(line); const row={}; headers.forEach((h,i)=>row[h]=vals[i]??''); return row;
  });
}
function parseCsvLine(line){
  const vals=[]; let cur=''; let q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"') { if(q && line[i+1]==='"'){cur+='"'; i++;} else q=!q; }
    else if(ch===',' && !q){ vals.push(cur); cur=''; }
    else cur+=ch;
  }
  vals.push(cur); return vals;
}

class OutboundService {
  constructor(root){
    this.root = root;
    this.dataDir = path.join(root,'DATA','OUTBOUND');
    this.now = () => new Date().toISOString();
  }
  init(){
    ensureDir(this.dataDir);
    this.seedRegistries();
    return this.status();
  }
  seedRegistries(){
    const last = this.now();
    const domainFile = path.join(this.dataDir,'DOMAIN_STATUS_MASTER.csv');
    const inboxFile = path.join(this.dataDir,'INBOX_STATUS_MASTER.csv');
    const campaignFile = path.join(this.dataDir,'CAMPAIGN_STATUS_MASTER.csv');
    const segmentFile = path.join(this.dataDir,'SEGMENT_INVENTORY_MASTER.csv');
    const assetFile = path.join(this.dataDir,'OUTBOUND_ASSET_REGISTRY.csv');
    const reportFile = path.join(this.dataDir,'OUTBOUND_DAILY_REPORT.csv');

    if(!fs.existsSync(domainFile)) writeCsv(domainFile,[
      {Domain:'pathways2gc.com',Role:'Administrative',Status:'Active',OutboundUse:'No',Health:'Protected',AssignedSegments:'None',PlannedInboxes:'0',ActiveInboxes:'0',DailyCapacity:'0',NeedsAction:'No',NextAction:'Do not use for outbound',LastUpdated:last},
      {Domain:'pathwaysgovcon.com',Role:'Production',Status:'Active',OutboundUse:'Yes',Health:'Healthy',AssignedSegments:'GSA Revenue; VA Revenue',PlannedInboxes:'5',ActiveInboxes:'5',DailyCapacity:'125',NeedsAction:'No',NextAction:'Monitor daily',LastUpdated:last},
      {Domain:'pathwaysgsa.com',Role:'Production',Status:'Active',OutboundUse:'Yes',Health:'Healthy',AssignedSegments:'GSA No Sales',PlannedInboxes:'3',ActiveInboxes:'3',DailyCapacity:'60',NeedsAction:'No',NextAction:'Monitor daily',LastUpdated:last},
      {Domain:'pathwaysgov.com',Role:'Production',Status:'Active',OutboundUse:'Yes',Health:'Healthy',AssignedSegments:'SAM; SBS',PlannedInboxes:'1',ActiveInboxes:'1',DailyCapacity:'20',NeedsAction:'No',NextAction:'Monitor daily',LastUpdated:last},
      {Domain:'pathwaysfederal.com',Role:'Expansion',Status:'Planned',OutboundUse:'Yes',Health:'Needs Provisioning',AssignedSegments:'HUBZone; 8(a); WOSB; SDVOSB; VOSB',PlannedInboxes:'6',ActiveInboxes:'0',DailyCapacity:'0',NeedsAction:'Yes',NextAction:'Create sales@, contracts@, capture@, federal@, growth@, partner@',LastUpdated:last},
      {Domain:'pathwaystogc.com',Role:'Expansion',Status:'Planned',OutboundUse:'Yes',Health:'Needs Provisioning',AssignedSegments:'Expiring 6 Months; Expiring 12 Months; Expired Everything',PlannedInboxes:'5',ActiveInboxes:'0',DailyCapacity:'0',NeedsAction:'Yes',NextAction:'Create sales@, contracts@, capture@, growth@, partner@',LastUpdated:last},
      {Domain:'pathways2gc.co',Role:'Expansion',Status:'Planned',OutboundUse:'Yes',Health:'Needs Provisioning',AssignedSegments:'Experimental',PlannedInboxes:'5',ActiveInboxes:'0',DailyCapacity:'0',NeedsAction:'Yes',NextAction:'Create sales@, contracts@, capture@, growth@, partner@',LastUpdated:last}
    ],['Domain','Role','Status','OutboundUse','Health','AssignedSegments','PlannedInboxes','ActiveInboxes','DailyCapacity','NeedsAction','NextAction','LastUpdated']);

    if(!fs.existsSync(inboxFile)) writeCsv(inboxFile,[
      ...['cora','evan','maya','silvia','victoria'].map(n=>({Email:`${n}@pathwaysgovcon.com`,Domain:'pathwaysgovcon.com',Status:'Active',Health:'Healthy',DailyLimit:'25',Warmup:'Enabled',AssignedUse:'GSA/VA campaigns',NeedsAction:'No',NextAction:'Monitor',LastUpdated:last})),
      ...['contacts','info','kevin'].map(n=>({Email:`${n}@pathwaysgsa.com`,Domain:'pathwaysgsa.com',Status:'Active',Health:'Healthy',DailyLimit:'20',Warmup:'Enabled',AssignedUse:'GSA No Sales',NeedsAction:'No',NextAction:'Monitor',LastUpdated:last})),
      {Email:'kevin@pathwaysgov.com',Domain:'pathwaysgov.com',Status:'Active',Health:'Healthy',DailyLimit:'20',Warmup:'Enabled',AssignedUse:'SAM/SBS campaigns',NeedsAction:'No',NextAction:'Monitor',LastUpdated:last},
      {Email:'info@pathways2gc.com',Domain:'pathways2gc.com',Status:'Admin Only',Health:'Protected',DailyLimit:'0',Warmup:'No',AssignedUse:'Super Admin only - not outbound',NeedsAction:'No',NextAction:'Protect from outbound use',LastUpdated:last},
      ...['sales','contracts','capture','federal','growth','partner'].map(n=>({Email:`${n}@pathwaysfederal.com`,Domain:'pathwaysfederal.com',Status:'Planned',Health:'Needs Creation',DailyLimit:'0',Warmup:'Not Started',AssignedUse:'Certification campaigns',NeedsAction:'Yes',NextAction:'Create Google Workspace user then add to Instantly',LastUpdated:last})),
      ...['sales','contracts','capture','growth','partner'].map(n=>({Email:`${n}@pathwaystogc.com`,Domain:'pathwaystogc.com',Status:'Planned',Health:'Needs Creation',DailyLimit:'0',Warmup:'Not Started',AssignedUse:'Expiring/Expired campaigns',NeedsAction:'Yes',NextAction:'Create Google Workspace user then add to Instantly',LastUpdated:last})),
      ...['sales','contracts','capture','growth','partner'].map(n=>({Email:`${n}@pathways2gc.co`,Domain:'pathways2gc.co',Status:'Planned',Health:'Needs Creation',DailyLimit:'0',Warmup:'Not Started',AssignedUse:'Experimental campaigns',NeedsAction:'Yes',NextAction:'Create Google Workspace user then add to Instantly',LastUpdated:last}))
    ],['Email','Domain','Status','Health','DailyLimit','Warmup','AssignedUse','NeedsAction','NextAction','LastUpdated']);

    if(!fs.existsSync(campaignFile)) writeCsv(campaignFile,[
      {Campaign:'GSA No Sales',Segment:'GSA No Sales',Domain:'pathwaysgsa.com',Status:'Needs Review',Health:'Unknown',BounceRate:'Unknown',ReplyRate:'Unknown',LeadStatus:'Needs Inventory Sync',NeedsAction:'Yes',NextAction:'Review Instantly campaign status and bounces',LastUpdated:last},
      {Campaign:'GSA Revenue',Segment:'GSA Revenue',Domain:'pathwaysgovcon.com',Status:'Needs Review',Health:'Unknown',BounceRate:'Unknown',ReplyRate:'Unknown',LeadStatus:'Needs Inventory Sync',NeedsAction:'Yes',NextAction:'Review Instantly campaign status and bounces',LastUpdated:last},
      {Campaign:'VA Revenue',Segment:'VA Revenue',Domain:'pathwaysgovcon.com',Status:'Needs Review',Health:'Unknown',BounceRate:'Unknown',ReplyRate:'Unknown',LeadStatus:'Needs Inventory Sync',NeedsAction:'Yes',NextAction:'Review Instantly campaign status and bounces',LastUpdated:last},
      {Campaign:'SAM',Segment:'SAM',Domain:'pathwaysgov.com',Status:'Needs Review',Health:'Unknown',BounceRate:'Unknown',ReplyRate:'Unknown',LeadStatus:'Needs Inventory Sync',NeedsAction:'Yes',NextAction:'Review Instantly campaign status and bounces',LastUpdated:last},
      {Campaign:'SBS',Segment:'SBS',Domain:'pathwaysgov.com',Status:'Needs Review',Health:'Unknown',BounceRate:'Unknown',ReplyRate:'Unknown',LeadStatus:'Needs Inventory Sync',NeedsAction:'Yes',NextAction:'Review Instantly campaign status and bounces',LastUpdated:last},
      {Campaign:'HUBZone',Segment:'HUBZone',Domain:'pathwaysfederal.com',Status:'Planned',Health:'Waiting on Inboxes',BounceRate:'N/A',ReplyRate:'N/A',LeadStatus:'Needs Segment Sync',NeedsAction:'Yes',NextAction:'Provision pathwaysfederal.com inboxes',LastUpdated:last},
      {Campaign:'8(a)',Segment:'8(a)',Domain:'pathwaysfederal.com',Status:'Planned',Health:'Waiting on Inboxes',BounceRate:'N/A',ReplyRate:'N/A',LeadStatus:'Needs Segment Sync',NeedsAction:'Yes',NextAction:'Provision pathwaysfederal.com inboxes',LastUpdated:last},
      {Campaign:'WOSB',Segment:'WOSB',Domain:'pathwaysfederal.com',Status:'Planned',Health:'Waiting on Inboxes',BounceRate:'N/A',ReplyRate:'N/A',LeadStatus:'Needs Segment Sync',NeedsAction:'Yes',NextAction:'Provision pathwaysfederal.com inboxes',LastUpdated:last},
      {Campaign:'SDVOSB',Segment:'SDVOSB',Domain:'pathwaysfederal.com',Status:'Planned',Health:'Waiting on Inboxes',BounceRate:'N/A',ReplyRate:'N/A',LeadStatus:'Needs Segment Sync',NeedsAction:'Yes',NextAction:'Provision pathwaysfederal.com inboxes',LastUpdated:last},
      {Campaign:'VOSB',Segment:'VOSB',Domain:'pathwaysfederal.com',Status:'Planned',Health:'Waiting on Inboxes',BounceRate:'N/A',ReplyRate:'N/A',LeadStatus:'Needs Segment Sync',NeedsAction:'Yes',NextAction:'Provision pathwaysfederal.com inboxes',LastUpdated:last},
      {Campaign:'Expiring 6 Months',Segment:'Expiring 6 Months',Domain:'pathwaystogc.com',Status:'Planned',Health:'Waiting on Inboxes',BounceRate:'N/A',ReplyRate:'N/A',LeadStatus:'Needs Segment Sync',NeedsAction:'Yes',NextAction:'Provision pathwaystogc.com inboxes',LastUpdated:last},
      {Campaign:'Expiring 12 Months',Segment:'Expiring 12 Months',Domain:'pathwaystogc.com',Status:'Planned',Health:'Waiting on Inboxes',BounceRate:'N/A',ReplyRate:'N/A',LeadStatus:'Needs Segment Sync',NeedsAction:'Yes',NextAction:'Provision pathwaystogc.com inboxes',LastUpdated:last},
      {Campaign:'Expired Everything',Segment:'Expired Everything',Domain:'pathwaystogc.com',Status:'Planned',Health:'Waiting on Inboxes',BounceRate:'N/A',ReplyRate:'N/A',LeadStatus:'Needs Segment Sync',NeedsAction:'Yes',NextAction:'Provision pathwaystogc.com inboxes',LastUpdated:last},
      {Campaign:'Experimental',Segment:'Experimental',Domain:'pathways2gc.co',Status:'Planned',Health:'Waiting on Inboxes',BounceRate:'N/A',ReplyRate:'N/A',LeadStatus:'Needs Segment Sync',NeedsAction:'Yes',NextAction:'Provision pathways2gc.co inboxes',LastUpdated:last}
    ],['Campaign','Segment','Domain','Status','Health','BounceRate','ReplyRate','LeadStatus','NeedsAction','NextAction','LastUpdated']);

    if(!fs.existsSync(segmentFile)) writeCsv(segmentFile,[
      {SegmentName:'GSA No Sales',Companies:'22775',Contacts:'Unknown',VerifiedEmails:'Unknown',VerificationPercent:'Unknown',Campaign:'GSA No Sales',AssignedDomain:'pathwaysgsa.com',AssignedInboxes:'contacts@; info@; kevin@',CampaignStatus:'Needs Review',NeedsVerification:'Unknown',NeedsUpload:'Unknown',NeedsEnrichment:'Unknown',Priority:'High',Owner:'Sophia/Miles',LastUpdated:last},
      {SegmentName:'GSA Revenue',Companies:'Unknown',Contacts:'Unknown',VerifiedEmails:'Unknown',VerificationPercent:'Unknown',Campaign:'GSA Revenue',AssignedDomain:'pathwaysgovcon.com',AssignedInboxes:'cora@; evan@; maya@; silvia@; victoria@',CampaignStatus:'Needs Review',NeedsVerification:'Unknown',NeedsUpload:'Unknown',NeedsEnrichment:'Unknown',Priority:'High',Owner:'Sophia/Miles',LastUpdated:last},
      {SegmentName:'VA Revenue',Companies:'Unknown',Contacts:'Unknown',VerifiedEmails:'Unknown',VerificationPercent:'Unknown',Campaign:'VA Revenue',AssignedDomain:'pathwaysgovcon.com',AssignedInboxes:'cora@; evan@; maya@; silvia@; victoria@',CampaignStatus:'Needs Review',NeedsVerification:'Unknown',NeedsUpload:'Unknown',NeedsEnrichment:'Unknown',Priority:'High',Owner:'Sophia/Miles',LastUpdated:last},
      {SegmentName:'SAM',Companies:'21252',Contacts:'Unknown',VerifiedEmails:'Unknown',VerificationPercent:'Unknown',Campaign:'SAM',AssignedDomain:'pathwaysgov.com',AssignedInboxes:'kevin@',CampaignStatus:'Needs Review',NeedsVerification:'Unknown',NeedsUpload:'Unknown',NeedsEnrichment:'Unknown',Priority:'High',Owner:'Sophia/Miles',LastUpdated:last},
      {SegmentName:'SBS',Companies:'Unknown',Contacts:'Unknown',VerifiedEmails:'2585+',VerificationPercent:'Unknown',Campaign:'SBS',AssignedDomain:'pathwaysgov.com',AssignedInboxes:'kevin@',CampaignStatus:'Needs Review',NeedsVerification:'No',NeedsUpload:'Unknown',NeedsEnrichment:'Unknown',Priority:'High',Owner:'Sophia/Miles',LastUpdated:last},
      ...['HUBZone','8(a)','WOSB','SDVOSB','VOSB'].map(s=>({SegmentName:s,Companies:'Unknown',Contacts:'Unknown',VerifiedEmails:'Unknown',VerificationPercent:'Unknown',Campaign:s,AssignedDomain:'pathwaysfederal.com',AssignedInboxes:'Planned',CampaignStatus:'Planned',NeedsVerification:'Yes',NeedsUpload:'Yes',NeedsEnrichment:'Unknown',Priority:'Medium',Owner:'Sophia/Miles',LastUpdated:last})),
      ...['Expiring 6 Months','Expiring 12 Months','Expired Everything'].map(s=>({SegmentName:s,Companies:'Unknown',Contacts:'Unknown',VerifiedEmails:'Unknown',VerificationPercent:'Unknown',Campaign:s,AssignedDomain:'pathwaystogc.com',AssignedInboxes:'Planned',CampaignStatus:'Planned',NeedsVerification:'Yes',NeedsUpload:'Yes',NeedsEnrichment:'Unknown',Priority:'High',Owner:'Sophia/Miles',LastUpdated:last})),
      {SegmentName:'Experimental',Companies:'Unknown',Contacts:'Unknown',VerifiedEmails:'Unknown',VerificationPercent:'Unknown',Campaign:'Experimental',AssignedDomain:'pathways2gc.co',AssignedInboxes:'Planned',CampaignStatus:'Planned',NeedsVerification:'Yes',NeedsUpload:'Yes',NeedsEnrichment:'Unknown',Priority:'Low',Owner:'Sophia/Miles',LastUpdated:last}
    ],['SegmentName','Companies','Contacts','VerifiedEmails','VerificationPercent','Campaign','AssignedDomain','AssignedInboxes','CampaignStatus','NeedsVerification','NeedsUpload','NeedsEnrichment','Priority','Owner','LastUpdated']);

    if(!fs.existsSync(assetFile)) writeCsv(assetFile,[
      {AssetType:'Domain',Name:'pathwaysgovcon.com',Status:'Active',UsedFor:'GSA/VA campaigns',Owner:'Miles',NextAction:'Monitor',LastUpdated:last},
      {AssetType:'Domain',Name:'pathwaysgsa.com',Status:'Active',UsedFor:'GSA No Sales campaigns',Owner:'Miles',NextAction:'Monitor',LastUpdated:last},
      {AssetType:'Domain',Name:'pathwaysgov.com',Status:'Active',UsedFor:'SAM/SBS campaigns',Owner:'Miles',NextAction:'Monitor',LastUpdated:last},
      {AssetType:'Domain',Name:'pathwaysfederal.com',Status:'Planned',UsedFor:'Certification campaigns',Owner:'Miles',NextAction:'Create planned inboxes',LastUpdated:last},
      {AssetType:'Domain',Name:'pathwaystogc.com',Status:'Planned',UsedFor:'Expiring/Expired campaigns',Owner:'Miles',NextAction:'Create planned inboxes',LastUpdated:last},
      {AssetType:'Domain',Name:'pathways2gc.co',Status:'Planned',UsedFor:'Experimental campaigns',Owner:'Miles',NextAction:'Create planned inboxes',LastUpdated:last}
    ],['AssetType','Name','Status','UsedFor','Owner','NextAction','LastUpdated']);

    if(!fs.existsSync(reportFile)) writeCsv(reportFile,[{Date:last.slice(0,10),OverallHealth:'Warning',ProductionInboxes:'9',PlannedInboxes:'16',DailyCapacity:'205',CampaignsNeedingReview:'5',ExpansionDomainsNeedingAction:'3',CriticalRules:'pathways2gc.com protected from outbound',TopPriority:'Review paused/unknown Instantly campaigns and provision expansion inboxes',GeneratedAt:last}],['Date','OverallHealth','ProductionInboxes','PlannedInboxes','DailyCapacity','CampaignsNeedingReview','ExpansionDomainsNeedingAction','CriticalRules','TopPriority','GeneratedAt']);
  }
  status(){
    const domains = readCsv(path.join(this.dataDir,'DOMAIN_STATUS_MASTER.csv'));
    const inboxes = readCsv(path.join(this.dataDir,'INBOX_STATUS_MASTER.csv'));
    const campaigns = readCsv(path.join(this.dataDir,'CAMPAIGN_STATUS_MASTER.csv'));
    const segments = readCsv(path.join(this.dataDir,'SEGMENT_INVENTORY_MASTER.csv'));
    const activeInboxes = inboxes.filter(i=>i.Status==='Active').length;
    const plannedInboxes = inboxes.filter(i=>i.Status==='Planned').length;
    const protectedAdmin = inboxes.find(i=>i.Email==='info@pathways2gc.com')?.Status || 'Unknown';
    const capacity = inboxes.reduce((sum,i)=>sum+(parseInt(i.DailyLimit)||0),0);
    const needsAction = [...domains,...inboxes,...campaigns,...segments].filter(x=>String(x.NeedsAction||x.NeedsUpload||x.NeedsVerification||'').includes('Yes')).length;
    const campaignReview = campaigns.filter(c=>c.Status==='Needs Review' || c.Status==='Planned').length;
    const health = needsAction > 0 ? 'Warning' : 'Healthy';
    const topActions = this.nextActions();
    return { department:'Outbound Operations', health, domains:domains.length, activeInboxes, plannedInboxes, dailyCapacity:capacity, campaigns:campaigns.length, segments:segments.length, campaignReview, needsAction, protectedAdmin, topActions, generatedAt:this.now() };
  }
  nextActions(){
    const rows = [];
    const domains = readCsv(path.join(this.dataDir,'DOMAIN_STATUS_MASTER.csv'));
    const inboxes = readCsv(path.join(this.dataDir,'INBOX_STATUS_MASTER.csv'));
    const campaigns = readCsv(path.join(this.dataDir,'CAMPAIGN_STATUS_MASTER.csv'));
    domains.filter(d=>d.NeedsAction==='Yes').forEach(d=>rows.push({Priority:'High',Area:'Domain',Item:d.Domain,Action:d.NextAction,ApprovalRequired:'No'}));
    campaigns.filter(c=>c.NeedsAction==='Yes').slice(0,8).forEach(c=>rows.push({Priority:c.Domain.includes('pathwaysfederal') || c.Domain.includes('pathwaystogc')?'Medium':'High',Area:'Campaign',Item:c.Campaign,Action:c.NextAction,ApprovalRequired:'No'}));
    inboxes.filter(i=>i.NeedsAction==='Yes').slice(0,8).forEach(i=>rows.push({Priority:'Medium',Area:'Inbox',Item:i.Email,Action:i.NextAction,ApprovalRequired:'No'}));
    return rows.slice(0,12);
  }
  reportMarkdown(){
    const s = this.status();
    const actions = s.topActions.map((a,i)=>`${i+1}. [${a.Priority}] ${a.Area}: ${a.Item} — ${a.Action}`).join('\n');
    return `# MILES Outbound Daily Report\n\nGenerated: ${s.generatedAt}\n\n## Health\n${s.health}\n\n## Capacity\n- Active inboxes: ${s.activeInboxes}\n- Planned inboxes: ${s.plannedInboxes}\n- Daily capacity: ${s.dailyCapacity}\n- Campaigns: ${s.campaigns}\n- Segments: ${s.segments}\n\n## Safety Rule\npathways2gc.com admin status: ${s.protectedAdmin}. This domain remains protected and excluded from outbound.\n\n## Top Actions\n${actions}\n`;
  }
}
module.exports = { OutboundService, readCsv, writeCsv };
