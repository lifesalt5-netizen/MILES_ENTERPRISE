'use strict';

const reviewId=location.pathname.split('/').filter(Boolean).pop();
const accessToken=new URLSearchParams(location.search).get('access')||'';
const calendlyUrl='https://calendly.com/kevin-pathways2gc/30min';
let current=null;let selectedPriority=null;let fired=new Set();
const $=id=>document.getElementById(id);

async function api(action,options={}){
  const response=await fetch(`/api/review/${encodeURIComponent(reviewId)}/${action}`,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  const body=await response.json().catch(()=>({ok:false,status:`HTTP_${response.status}`}));
  if(!response.ok||body.ok===false) throw new Error(body.status||body.reason||'REQUEST_FAILED');
  return body;
}
function msg(id,text){$(id).textContent=text||'';}
function esc(text){const d=document.createElement('div');d.textContent=String(text||'');return d.innerHTML;}

async function sendCode(){
  msg('verifyMessage','Sending verification code…');
  try{await api('request-code',{method:'POST',body:JSON.stringify({accessToken,email:$('email').value})});$('codeBox').hidden=false;msg('verifyMessage','Verification code sent from Kevin at Pathways 2 Government Contracting.');}
  catch(error){msg('verifyMessage',error.message==='SAME_COMPANY_AUTHORIZATION_REQUIRED'?'This colleague needs authorization before access can be granted.':error.message==='OUTSIDE_ORGANIZATION_ACCESS_DENIED'?'This review is not authorized for that email address.':'Unable to send verification code.');}
}
async function verifyCode(){
  msg('verifyMessage','Verifying…');
  try{const result=await api('verify',{method:'POST',body:JSON.stringify({accessToken,email:$('email').value,code:$('code').value})});render(result.review,result.watermark);$('verify').hidden=true;$('review').hidden=false;msg('status','Your secure personalized review is ready.');}
  catch(error){msg('verifyMessage',error.message==='VERIFICATION_CODE_INVALID'?'That code is not valid. Please check it and try again.':error.message);}
}
function render(review,watermark){
  current=review;$('company').textContent=review.company?.name||'Federal Growth Review';$('expires').textContent=`Secure access expires ${new Date(review.expiresAt).toLocaleString()}`;$('watermark').textContent=watermark?.label||'';$('runtime').textContent=review.runtime?.display||review.runtime?.formatted||'Target presentation length: approximately 6–10 minutes.';
  const findings=review.findings||[];$('findings').innerHTML=findings.map(f=>`<article class="finding"><h3>${esc(f.title)}</h3><p>${esc(f.finding)}</p><p><strong>WHAT IT MEANS</strong><br>${esc(f.whatItMeans)}</p><p><strong>WHY IT MATTERS</strong><br>${esc(f.whyItMatters)}</p><p><strong>BUSINESS IMPACT</strong><br>${esc(f.businessImpact)}</p><p><strong>HOW P2GC ADDRESSES IT</strong><br>${esc(f.howP2GCAddressesIt)}</p></article>`).join('')||'<p>No representative findings are available yet.</p>';
  if(review.lockedFindingCount>0){$('locked').hidden=false;$('locked').textContent=`${review.lockedFindingCount} additional finding${review.lockedFindingCount===1?'':'s'} are reserved for the deeper paid engagement.`;}
  $('priorities').innerHTML=(review.priorityOptions||[]).map(p=>`<button class="priority" data-id="${esc(p.id)}">${esc(p.label)}</button>`).join('');document.querySelectorAll('.priority').forEach(btn=>btn.addEventListener('click',()=>{selectedPriority=btn.dataset.id;document.querySelectorAll('.priority').forEach(x=>x.classList.toggle('active',x===btn));}));
  if(review.video?.playable===true) setupVideo();else $('videoPending').hidden=false;
}
async function setupVideo(){
  try{const result=await api('video-token',{method:'POST',body:'{}'});if(!result.streamUrl)throw new Error('VIDEO_STREAM_NOT_READY');const v=$('video');v.hidden=false;$('videoPending').hidden=true;v.src=result.streamUrl;attachVideoTelemetry(v);}catch{ $('videoPending').hidden=false; }
}
function event(type,value=null,metadata=null){return api('event',{method:'POST',body:JSON.stringify({type,value,metadata})}).catch(()=>null);}
function once(type,value){if(fired.has(type))return;fired.add(type);event(type,value);}
function attachVideoTelemetry(v){v.addEventListener('play',()=>once('VIDEO_START',0));v.addEventListener('timeupdate',()=>{if(!v.duration)return;const p=(v.currentTime/v.duration)*100;if(p>=25)once('VIDEO_25',25);if(p>=50)once('VIDEO_50',50);if(p>=75)once('VIDEO_75',75);if(p>=90)once('VIDEO_90',90);});v.addEventListener('ended',()=>once('VIDEO_COMPLETE',100));}
async function submitQuestion(){const question=$('question').value.trim();if(!question)return msg('questionMessage','Enter a question first.');try{await api('question',{method:'POST',body:JSON.stringify({question,priorityOptionId:selectedPriority})});msg('questionMessage','Your question was saved for Kevin.');$('question').value='';}catch(error){msg('questionMessage',error.message);}}
async function schedule(){await event('CTA_CLICK',1,{cta:'REVIEW_YOUR_FINDINGS_WITH_KEVIN'});await event('SCHEDULING_OPENED',1);location.href=calendlyUrl;}
async function restore(){try{const result=await api('state',{method:'GET'});render(result.review,result.watermark);$('verify').hidden=true;$('review').hidden=false;}catch{}}
$('sendCode').addEventListener('click',sendCode);$('verifyCode').addEventListener('click',verifyCode);$('submitQuestion').addEventListener('click',submitQuestion);$('schedule').addEventListener('click',schedule);restore();
