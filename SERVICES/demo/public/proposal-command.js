'use strict';

const $ = id => document.getElementById(id);
function render(data){
  $('status').textContent = `${data.product || data.service || 'P2GC Proposal Command'} · ${data.qualification?.decision || data.status || 'READY'}`;
  const review = data.evaluatorReview || {};
  $('scores').innerHTML = [
    ['Readiness', review.proposalReadinessScore],['Compliance', review.complianceScore],['Competitive', review.competitiveStrengthScore]
  ].map(([k,v])=>`<div><strong>${k}</strong><br>${Number.isFinite(v)?v:'—'}</div>`).join('');
  $('stages').innerHTML = (data.stages || []).map(s=>`<div class="pc-stage"><strong>${s.name}</strong><br><span class="muted">${s.status}</span>${s.decision?` · ${s.decision}`:''}</div>`).join('') || '<div class="muted">No stage data.</div>';
  $('result').textContent = JSON.stringify(data,null,2);
}

$('run').addEventListener('click', async()=>{
  let payload;
  try{ payload = JSON.parse($('payload').value); }
  catch(error){ $('status').textContent=`Invalid JSON: ${error.message}`; return; }
  $('status').textContent='Running controlled Proposal Command pipeline…';
  try{
    const res = await fetch('/api/proposal-command/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data = await res.json(); render(data);
  }catch(error){ $('status').textContent=`Run failed: ${error.message}`; }
});

$('health').addEventListener('click',async()=>{
  try{ const res=await fetch('/api/proposal-command/health'); render(await res.json()); }
  catch(error){ $('status').textContent=`Health failed: ${error.message}`; }
});
