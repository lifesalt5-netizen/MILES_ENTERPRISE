'use strict';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(v||0));
const count=v=>new Intl.NumberFormat('en-US').format(Number(v||0));
let snapshot=null;
let calendarView='today';

async function getJson(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}
function fmtDate(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?esc(v):d.toLocaleString();}
function rows(items,render,empty='No activity recorded yet.'){return Array.isArray(items)&&items.length?items.map(render).join(''):`<div class="empty-state">${esc(empty)}</div>`;}
function table(headers,body){return `<div class="table-wrap"><table class="marketing-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;}
function metric(label,value,sub=''){return `<div class="metric"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(sub)}</small></div>`;}
function pill(v){return `<span class="pill">${esc(v||'UNKNOWN')}</span>`;}
function exactMessage(v){return `<div class="copy">${esc(v||'')}</div>`;}

function renderGovernance(){
  const g=snapshot.governance||{},p=snapshot.protectedPrimaryDomain||{};
  $('governance').innerHTML=`<div class="marketing-grid"><div class="metric guard bad"><span>Protected Primary Domain</span><b>${esc(p.domain||'p2gc.com')}</b><small>Cold sending: ${esc(p.coldSending||'DISABLED')} · Failover: ${esc(p.failover||'DISABLED')}</small></div>${metric('Visible Sender',snapshot.senderIdentity||'Kevin','Last name excluded from outreach')}${metric('Optimization Order',(g.qualityOrder||[]).join(' → '),'Raw send volume is not the target')}${metric('Global Suppression',g.globalSuppressionRequired?'REQUIRED':'UNKNOWN','Applies across outbound channels')}</div>`;
}

function renderWhatGoingOut(){
  const w=snapshot.whatIsGoingOut||{};
  const body=rows(w.today,x=>`<tr><td>${fmtDate(x.scheduledAt)}</td><td>${pill(x.channel)}</td><td>${esc(x.campaign||'—')}</td><td>${esc(x.segment||'—')}</td><td>${esc(x.action||'—')}</td><td>${count(x.audienceSize||0)}</td><td>${esc(x.sendingMailbox||x.account||'—')}</td><td>${pill(x.status)}</td><td>${exactMessage(x.message||x.subject)}</td></tr>`,'Nothing scheduled or completed today yet.');
  $('whatGoingOut').innerHTML=`<div class="marketing-grid">${metric('Total Marketing Touches Today',count(w.totalMarketingTouchesToday||0),'All approved channels')}</div>${table(['Time','Channel','Campaign','Segment','Action','Audience','Mailbox / Account','Status','Exact Message'],body)}`;
}

function renderCalendar(){
  const items=(snapshot.calendar||{})[calendarView]||[];
  const body=rows(items,x=>`<tr><td>${fmtDate(x.scheduledAt)}</td><td>${pill(x.channel)}</td><td>${esc(x.campaign||'—')}</td><td>${esc(x.segment||'—')}</td><td>${esc(x.action||'—')}</td><td>${count(x.audienceSize||0)}</td><td>${pill(x.status)}</td><td>${exactMessage(x.message||x.subject)}</td></tr>`);
  $('calendar').innerHTML=table(['Date / Time','Channel','Campaign','Segment','Action','Audience','Status','Message'],body);
  document.querySelectorAll('[data-calendar]').forEach(btn=>btn.classList.toggle('secondary',btn.dataset.calendar!==calendarView));
}

function renderScorecard(){
  const s=snapshot.scorecard||{};
  const period=(title,data)=>`<div><h3>${esc(title)}</h3><div class="marketing-grid">${metric('Companies Scanned',count(data?.companiesScanned))}${metric('Qualified for Outreach',count(data?.companiesWithMeaningfulFinding))}${metric('Outreach Sent',count(data?.outreachSent))}${metric('Positive Replies',count(data?.positiveReplies))}${metric('Diagnostics Requested',count(data?.diagnosticRequested))}${metric('Diagnostics Viewed',count(data?.diagnosticViewed))}${metric('Qualified',count(data?.qualified))}${metric('Meetings',count(data?.meeting))}${metric('LinkedIn Prospects',count(data?.linkedinProspectsIdentified))}${metric('Connections Sent',count(data?.linkedinConnectionsSent))}${metric('Posts Published',count(data?.marketingPostsPublished))}${metric('Closed Won',count(data?.closedWon),money(data?.revenue||0))}</div></div>`;
  $('scorecard').innerHTML=period('Today',s.today||{})+period('Week to Date',s.weekToDate||{})+period('Month to Date',s.monthToDate||{});
}

function renderEmail(){
  const e=snapshot.emailActivity||{};
  const campaigns=rows(e.campaigns,x=>`<tr><td>${esc(x.name||'—')}</td><td>${esc(x.segment||'—')}</td><td>${esc(x.sendingDomain||'—')}</td><td>${esc(x.sendingMailbox||'—')}</td><td>${esc(x.senderDisplayName||'Kevin')}</td><td>${esc(x.subject||'—')}</td><td>${exactMessage(x.firstTouchBody)}</td><td>${pill(x.status)}</td><td>${count(x.metrics?.sent)}</td><td>${count(x.metrics?.positiveReplies)}</td><td>${count(x.metrics?.diagnosticRequests)}</td><td>${count(x.metrics?.meetings)}</td><td>${count(x.metrics?.closes)}</td><td>${money(x.metrics?.revenue)}</td></tr>`,'No governed campaigns registered yet.');
  const history=rows(e.exactMessageHistory,x=>`<tr><td>${fmtDate(x.timestamp)}</td><td>${esc(x.campaign||'—')}</td><td>${esc(x.recipient||'—')}</td><td>${esc(x.senderMailbox||'—')}</td><td>${esc(x.subject||'—')}</td><td>${exactMessage(x.renderedMessage||x.message)}</td><td>${pill(x.status)}</td><td>${esc(x.reply||'')}</td></tr>`,'No email send history yet.');
  $('emailActivity').innerHTML=`<h3>Campaign Performance</h3>${table(['Campaign','Segment','Domain','Mailbox','Sender','Subject','Exact Copy','Status','Sent','Positive','Diagnostic','Meetings','Wins','Revenue'],campaigns)}<h3>Exact Message History</h3>${table(['Sent','Campaign','Recipient','Mailbox','Subject','Rendered Message','Status','Reply'],history)}`;
}

function renderDomains(){
  const body=rows(snapshot.outboundDomainHealth,x=>`<tr><td>${esc(x.domain)}</td><td>${esc(x.mailbox||'—')}</td><td>${pill(x.warmupStatus)}</td><td>${pill(x.sendingStatus)}</td><td>${count(x.dailyVolume)}</td><td>${x.bounceRate==null?'—':esc(x.bounceRate)}</td><td>${x.replyRate==null?'—':esc(x.replyRate)}</td><td>${esc(x.spamComplaintSignals??'—')}</td><td>${pill(x.inboxPlacementStatus)}</td><td>${pill(x.healthIndicator)}</td><td>${fmtDate(x.lastHealthCheck)}</td><td>${count(x.recommendedMaxSendingVolume)}</td></tr>`);
  $('domainHealth').innerHTML=table(['Domain','Mailbox','Warmup','Sending','Daily Volume','Bounce','Reply','Spam Signals','Inbox Placement','Health','Last Check','Recommended Max'],body);
}

function renderLinkedIn(){
  const l=snapshot.linkedinActivity||{};
  const block=(title,items)=>`<h3>${esc(title)}</h3>${table(['Date','Campaign / Segment','Action','Recipient / Audience','Exact Message','Result'],rows(items,x=>`<tr><td>${fmtDate(x.timestamp)}</td><td>${esc([x.campaign,x.segment].filter(Boolean).join(' · ')||'—')}</td><td>${esc(x.action||'—')}</td><td>${esc(x.recipient||count(x.audienceSize))}</td><td>${exactMessage(x.renderedMessage||x.message)}</td><td>${esc(typeof x.result==='object'?JSON.stringify(x.result):x.result||'')}</td></tr>`))}`;
  $('linkedinActivity').innerHTML=block('Searches',l.searches)+block('Connections',l.connections)+block('Messages',l.messages)+block('Posts',l.posts);
}

function renderDiagnostics(){
  const d=snapshot.diagnostics||{},q=snapshot.qualification||{};
  const items=rows(d.items,x=>`<tr><td>${esc(x.company)}</td><td>${esc(x.contact||'—')}</td><td>${esc(x.outreachSegment||'—')}</td><td>${esc(x.status||'—')}</td><td>${esc(x.salesReadinessEstimate||'—')}</td><td>${esc((x.strongestFindings||[]).map(f=>f.finding).join(' | '))}</td><td>${esc(x.privatePath||'—')}</td></tr>`,'No company-specific diagnostics prepared yet.');
  $('diagnostics').innerHTML=`<div class="marketing-grid">${metric('Diagnostics Prepared',count(d.prepared))}${metric('High Intent',count(q.highIntent))}${metric('Research Only / Nurture',count(q.researchOnly))}</div>${table(['Company','Contact','Segment','Status','Readiness','Strongest Findings','Private Path'],items)}`;
}

function renderFunnel(){
  const f=snapshot.funnel||{},st=f.stages||{};
  const sequence=['companiesScanned','companiesWithMeaningfulFinding','outreachSent','replies','positiveReplies','diagnosticRequested','diagnosticViewed','fullReviewRequested','qualified','meeting','proposal','closedWon'];
  const body=sequence.map((name,i)=>{const conversion=(f.conversions||[]).find(x=>x.to===name);return `<tr><td>${i+1}</td><td>${esc(name)}</td><td>${count(st[name]||0)}</td><td>${conversion?esc(conversion.ratePct+'%'):'—'}</td></tr>`;}).join('');
  $('funnel').innerHTML=table(['#','Stage','Count','Conversion From Prior'],body);
}

function renderMessages(){
  const body=rows(snapshot.messageLibrary,x=>`<tr><td>${fmtDate(x.createdAt)}</td><td>${esc(x.version)}</td><td>${pill(x.active?'ACTIVE':'INACTIVE')}</td><td>${esc(x.channel)}</td><td>${esc(x.segment)}</td><td>${esc(x.type)}</td><td>${esc(x.subject)}</td><td>${exactMessage(x.content)}</td><td>${count(x.metrics?.sends)}</td><td>${count(x.metrics?.positiveReplies)}</td><td>${count(x.metrics?.diagnosticRequests)}</td><td>${count(x.metrics?.meetings)}</td><td>${money(x.metrics?.closedRevenue)}</td></tr>`,'No message versions registered yet.');
  $('messageLibrary').innerHTML=table(['Created','Version','Status','Channel','Segment','Type','Subject','Copy','Sends','Positive','Diagnostics','Meetings','Revenue'],body);
}

function renderAudit(){
  const body=rows(snapshot.auditHistory,x=>`<tr><td>${fmtDate(x.timestamp)}</td><td>${esc(x.channel)}</td><td>${esc(x.systemUser)}</td><td>${esc(x.campaign||'—')}</td><td>${esc(x.segment||'—')}</td><td>${esc(x.recipient||count(x.audienceSize))}</td><td>${esc(x.senderMailbox||'—')}</td><td>${esc(x.subject||'—')}</td><td>${exactMessage(x.renderedMessage||x.message)}</td><td>${pill(x.status)}</td><td>${esc(x.reply||'')}</td></tr>`,'No permanent audit activity recorded yet.');
  $('audit').innerHTML=table(['Timestamp','Channel','System/User','Campaign','Segment','Recipient/Audience','Mailbox','Subject','Final Rendered Message','Result','Reply'],body);
}

function renderAll(){renderGovernance();renderWhatGoingOut();renderCalendar();renderScorecard();renderEmail();renderDomains();renderLinkedIn();renderDiagnostics();renderFunnel();renderMessages();renderAudit();}
async function load(){
  $('refreshMarketing').disabled=true;
  try{snapshot=await getJson('/marketing-activity.json');renderAll();}
  catch(error){document.querySelector('main').insertAdjacentHTML('beforeend',`<section class="panel"><h2>Marketing Activity unavailable</h2><p>${esc(error.message)}</p></section>`);}
  finally{$('refreshMarketing').disabled=false;}
}

document.querySelectorAll('[data-calendar]').forEach(btn=>btn.addEventListener('click',()=>{calendarView=btn.dataset.calendar;renderCalendar();}));
$('refreshMarketing').addEventListener('click',load);
load();
