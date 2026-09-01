'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const ExecutiveGrowthBlueprintDemoService = require('./SERVICES/demo/ExecutiveGrowthBlueprintDemoService');
const DemoTruthReconciliationService = require('./SERVICES/demo/DemoTruthReconciliationService');
const DemoCommercialPreviewService = require('./SERVICES/demo/DemoCommercialPreviewService');
const DemoCanonicalIntelligenceService = require('./SERVICES/demo/DemoCanonicalIntelligenceService');
const DemoLiveOpportunityOverlayService = require('./SERVICES/demo/DemoLiveOpportunityOverlayService');
const P2GCFocusedIntelligenceService = require('./SERVICES/demo/P2GCFocusedIntelligenceService');
const P2GCPrimeSubTeamingService = require('./SERVICES/teaming/P2GCPrimeSubTeamingService');
const FederalPathwayScoreIntegratedService = require('./SERVICES/FederalPathwayScoreIntegratedService');
const P2GCProposalCommandService = require('./SERVICES/proposal/P2GCProposalCommandService');

const ROOT = __dirname;
const PORT = Number(process.env.P2GC_GROWTH_DEMO_PORT || 8791);
const PUBLIC = path.join(ROOT, 'SERVICES', 'demo', 'public');
const service = new ExecutiveGrowthBlueprintDemoService();
const truthReconciler = new DemoTruthReconciliationService();
const commercialPreview = new DemoCommercialPreviewService();
const canonical = new DemoCanonicalIntelligenceService({ root:ROOT });
const liveOpportunities = new DemoLiveOpportunityOverlayService();
const focused = new P2GCFocusedIntelligenceService();
const teaming = new P2GCPrimeSubTeamingService({ blueprintService:service });
const pathwayScore = new FederalPathwayScoreIntegratedService();
const proposalCommand = new P2GCProposalCommandService();
const cache = new Map();
const TTL = Math.max(1000, Number(process.env.P2GC_GROWTH_DEMO_CACHE_MS || 300000));

function send(res, status, type, body, extra={}) { res.writeHead(status, { 'Content-Type':type, 'Cache-Control':'no-store', ...extra }); res.end(body); }
function json(res, status, body) { send(res, status, 'application/json; charset=utf-8', JSON.stringify(body,null,2)); }
function staticFile(res, name, type) { const file=path.join(PUBLIC,name); if (!fs.existsSync(file)) return send(res,404,'text/plain; charset=utf-8','Not found'); send(res,200,type,fs.readFileSync(file)); }
function key(term) { return String(term||'').trim().toUpperCase(); }
function readJsonBody(req, limitBytes=2*1024*1024) { return new Promise((resolve,reject)=>{ let raw=''; req.on('data',c=>{ raw+=c; if(Buffer.byteLength(raw,'utf8')>limitBytes) reject(new Error('REQUEST_TOO_LARGE')); }); req.on('end',()=>{ if(!raw.trim()) return resolve({}); try{resolve(JSON.parse(raw));}catch{reject(new Error('INVALID_JSON'));} }); req.on('error',reject); }); }

async function buildModel(term) {
  const base = service.build(term);
  if (!base?.ok) return base;
  const firstTruth = truthReconciler.reconcile(base);
  const canonicalModel = await canonical.enrich(firstTruth);
  const liveModel = await liveOpportunities.apply(canonicalModel);
  const finalTruth = truthReconciler.reconcile(liveModel);
  return commercialPreview.apply(finalTruth);
}

async function getModel(term, refresh=false) {
  const k=key(term);
  if (!refresh && cache.has(k)) {
    const hit=cache.get(k);
    if (Date.now()-hit.at<TTL) return { ...hit.model, cache:{ hit:true, ttlMs:TTL } };
    cache.delete(k);
  }
  const model=await buildModel(term);
  if (model?.ok) {
    const aliases=[term,model.profile?.companyName,model.profile?.uei,model.profile?.cage,model.profile?.website].map(key).filter(Boolean);
    const record={at:Date.now(),model}; aliases.forEach(a=>cache.set(a,record));
  }
  return model?.ok ? { ...model, cache:{ hit:false, ttlMs:TTL } } : model;
}

async function handle(req,res) {
  const url=new URL(req.url,`http://localhost:${PORT}`);
  const pathname=url.pathname;
  if (req.method==='GET' && (pathname==='/' || pathname==='/demo')) return staticFile(res,'index.html','text/html; charset=utf-8');
  if (req.method==='GET' && pathname==='/teaming') return staticFile(res,'teaming.html','text/html; charset=utf-8');
  if (req.method==='GET' && pathname==='/proposal-command') return staticFile(res,'proposal-command.html','text/html; charset=utf-8');
  if (req.method==='GET' && ['/opportunities','/vehicles','/recompetes'].includes(pathname)) return staticFile(res,'intelligence.html','text/html; charset=utf-8');
  if (req.method==='GET' && pathname==='/app.js') return staticFile(res,'app.js','application/javascript; charset=utf-8');
  if (req.method==='GET' && pathname==='/proposal-command.js') return staticFile(res,'proposal-command.js','application/javascript; charset=utf-8');
  if (req.method==='GET' && pathname==='/styles.css') return staticFile(res,'styles.css','text/css; charset=utf-8');
  if (req.method==='GET' && pathname==='/favicon.ico') { res.writeHead(204); return res.end(); }

  if (req.method==='GET' && pathname==='/api/health') return json(res,200,{ok:true,status:'HEALTHY',service:'P2GC_EXECUTIVE_GROWTH_BLUEPRINT_DEMO',capabilities:['executive_growth_blueprint','canonical_award_truth','prime_subaward_history','buyer_agency_intelligence','sam_live_opportunity_feed','orion_current_opportunity_refilter','gsa_current_holder_lookup','truth_reconciliation','commercial_preview','federal_pathway_score','prime_sub_teaming','recompete_intelligence','proposal_command'],port:PORT,checkedAt:new Date().toISOString()});
  if (req.method==='GET' && pathname==='/api/proposal-command/health') return json(res,200,proposalCommand.healthCheck());
  if (req.method==='POST' && pathname==='/api/proposal-command/run') { try { const p=await readJsonBody(req); return json(res,200,proposalCommand.run(p)); } catch(e){ return json(res,e.message==='REQUEST_TOO_LARGE'?413:400,{ok:false,status:e.message,error:e.message}); } }

  const term=String(url.searchParams.get('term')||'').trim();
  if (['/api/assessment','/api/pathway-score','/api/intelligence','/api/teaming','/api/blueprint'].includes(pathname) && !term) return json(res,400,{ok:false,status:'TERM_REQUIRED',message:'Enter company name, UEI, CAGE, or website.'});

  try {
    if (req.method==='GET' && pathname==='/api/assessment') { const m=await getModel(term,url.searchParams.get('refresh')==='1'); return json(res,m?.ok?200:404,m); }
    if (req.method==='GET' && pathname==='/api/pathway-score') { const r=await pathwayScore.evaluate(term); return json(res,r?.ok?200:404,r); }
    if (req.method==='GET' && pathname==='/api/intelligence') { const m=await getModel(term,url.searchParams.get('refresh')==='1'); if(!m?.ok)return json(res,404,m); const r=focused.build(String(url.searchParams.get('type')||'').trim(),m); return json(res,r?.ok?200:400,r); }
    if (req.method==='GET' && pathname==='/api/teaming') { const m=await getModel(term,url.searchParams.get('refresh')==='1'); if(!m?.ok)return json(res,404,m); const r=teaming.fromBlueprint(m); r.canonicalPrimePartners=m.primePartners; r.canonicalSubcontracting=m.subcontracting; return json(res,200,r); }
    if (req.method==='GET' && pathname==='/api/blueprint') { const m=await getModel(term,false); if(!m?.ok)return json(res,404,m); const format=String(url.searchParams.get('format')||'md').toLowerCase(); const safe=String(m.profile?.companyName||m.profile?.uei||'prospect').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,80); if(format==='json')return send(res,200,'application/json; charset=utf-8',JSON.stringify(m,null,2),{'Content-Disposition':`attachment; filename="P2GC_Growth_Blueprint_${safe}.json"`}); return send(res,200,'text/markdown; charset=utf-8',service.toMarkdown(m),{'Content-Disposition':`attachment; filename="P2GC_Growth_Blueprint_${safe}.md"`}); }
  } catch(error) { return json(res,500,{ok:false,status:'DEMO_REQUEST_FAILED',error:error.message}); }
  return send(res,404,'text/plain; charset=utf-8','Not found');
}

const server=http.createServer((req,res)=>{ handle(req,res).catch(e=>json(res,500,{ok:false,status:'UNHANDLED_DEMO_ERROR',error:e.message})); });
server.listen(PORT,'127.0.0.1',()=>console.log(`P2GC Executive Government Growth Blueprint Demo: http://127.0.0.1:${PORT}`));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
