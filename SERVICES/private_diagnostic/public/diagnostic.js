'use strict';

const token=location.pathname.split('/').filter(Boolean).pop()||'';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let current=null;let scheduleUrl='';const fired=new Set();

async function api(action,options={}){
  const response=await fetch(`/api/private-diagnostic/${encodeURIComponent(token)}/${action}`,{cache:'no-store',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  const body=await response.json().catch(()=>({ok:false,status:`HTTP_${response.status}`}));
  if(!response.ok||body.ok===false)throw new Error(body.status||body.error||'REQUEST_FAILED');
  return body;
}
function event(event,section='',extra={}){return api('event',{method:'POST',body:JSON.stringify({event,section,...extra})}).catch(()=>null);}
function once(key,fn){if(fired.has(key))return;fired.add(key);fn();}
function list(items){const values=Array.isArray(items)?items.filter(Boolean):[];return values.length?`<ul class="path-list">${values.map(x=>`<li>${esc(typeof x==='string'?x:(x.title||x.name||x.finding||JSON.stringify(x)))}</li>`).join('')}</ul>`:'<p class="muted">No representative item is shown in the free preview.</p>';}
function positionItem(label,value){if(!value||(Array.isArray(value)&&!value.length))return'';const display=Array.isArray(value)?value.join(', '):value;return `<div class="position-item"><span>${esc(label)}</span><b>${esc(display)}</b></div>`;}
function findingCard(f){return `<article class="finding"><span class="label">${esc(f.label||'COMPANY-SPECIFIC FINDING')}</span><h3>${esc(f.finding)}</h3><div class="finding-meta"><div><span>Source</span><b>${esc(f.source)}</b></div><div><span>As of</span><b>${esc(f.asOfDate)}</b></div><div><span>Metric definition</span><b>${esc(f.metricDefinition)}</b></div></div></article>`;}
function opportunityCard(o){return `<article class="opportunity" data-opportunity-id="${esc(o.id||'')}"><h3>${esc(o.title||'Opportunity signal')}</h3><div class="opportunity-meta">${[o.agency,o.dueDate,o.fit].filter(Boolean).map(esc).join(' · ')}</div></article>`;}

function render(d){
  current=d;$('companyName').textContent=d.company||'Company Review';$('preparedAt').textContent=d.preparedAt?`Prepared ${new Date(d.preparedAt).toLocaleString()}`:'';
  const p=d.position||{};$('positionGrid').innerHTML=[positionItem('Federal status',p.federalStatus),positionItem('GSA position',p.gsaStatus),positionItem('VA position',p.vaStatus),positionItem('SINs',p.sins),positionItem('NAICS',p.naics),positionItem('Top agencies',p.topAgencies)].join('')||'<p class="muted">Position details are included only where supported by current source data.</p>';
  $('findings').innerHTML=(d.findings||[]).map(findingCard).join('')||'<p class="muted">No representative findings are available.</p>';
  if(Number(d.lockedFindingCount||0)>0){$('locked').hidden=false;$('locked').textContent=`${d.lockedFindingCount} additional company-specific finding${d.lockedFindingCount===1?' is':'s are'} held for the complete review.`;}
  $('protect').innerHTML=list(d.pathways?.protect);$('expand').innerHTML=list(d.pathways?.expand);$('capture').innerHTML=list(d.pathways?.capture);
  const ops=d.opportunityPreview||[];if(ops.length){$('opportunitySection').hidden=false;$('opportunities').innerHTML=ops.map(opportunityCard).join('');if(Number(d.additionalOpportunitySignals||0)>0){$('moreOpportunities').hidden=false;$('moreOpportunities').textContent=`${d.additionalOpportunitySignals} additional opportunity signal${d.additionalOpportunitySignals===1?' is':'s are'} held for the complete review.`;}}
  $('loading').hidden=true;$('content').hidden=false;
  once('overview',()=>event('SECTION_VIEW','OVERVIEW'));once('findings',()=>event('SECTION_VIEW','FINDINGS'));
}

async function load(){try{const result=await api('state',{method:'GET'});render(result.diagnostic);}catch{$('loading').hidden=true;$('error').hidden=false;}}

function bindSectionTracking(){
  const targets=[['findingsSection','FINDINGS'],['pathwaysSection','PROTECT_EXPAND_CAPTURE'],['opportunitySection','OPPORTUNITIES'],['qualificationSection','QUALIFICATION']];
  if(!('IntersectionObserver'in window))return;
  const io=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const match=targets.find(([id])=>id===entry.target.id);if(match)once(`section:${match[1]}`,()=>event('SECTION_VIEW',match[1]));}},{threshold:.35});
  for(const [id]of targets){const node=$(id);if(node)io.observe(node);}
}

async function qualify(){
  const payload={goal:$('goal').value.trim(),executionPreference:$('executionPreference').value,timing:$('timing').value,willingnessToInvest:$('willingnessToInvest').value,salesQuestion:$('salesQuestion').value.trim()};
  if(!payload.goal||!payload.executionPreference||!payload.timing||!payload.willingnessToInvest){$('qualificationMessage').textContent='Please answer all four qualification questions.';return;}
  $('requestReview').disabled=true;$('qualificationMessage').textContent='Reviewing your answers…';
  try{
    const result=await api('qualify',{method:'POST',body:JSON.stringify(payload)});
    $('qualificationMessage').textContent=result.message||'';
    if(result.scheduleAllowed===true&&result.scheduleUrl){scheduleUrl=result.scheduleUrl;$('qualifiedCta').hidden=false;$('qualifiedCta').scrollIntoView({behavior:'smooth',block:'center'});}
  }catch(error){$('qualificationMessage').textContent='We could not save your answers. Please try again.';}
  finally{$('requestReview').disabled=false;}
}

$('requestReview').addEventListener('click',()=>{event('QUALIFICATION_START','QUALIFICATION',{cta:'REQUEST_FULL_COMPANY_REVIEW'});qualify();});
$('schedule').addEventListener('click',async()=>{if(!scheduleUrl)return;await event('SCHEDULE_CLICK','QUALIFIED_CTA',{cta:'KEVIN_SCHEDULE'});location.href=scheduleUrl;});
document.addEventListener('click',e=>{const op=e.target.closest('[data-opportunity-id]');if(op)event('OPPORTUNITY_OPEN','OPPORTUNITIES',{opportunityId:op.dataset.opportunityId});});
for(const id of ['goal','executionPreference','timing','willingnessToInvest']){$(id).addEventListener('change',()=>event('QUALIFICATION_CHANGE','QUALIFICATION',{metadata:{field:id}}));}

bindSectionTracking();load();
