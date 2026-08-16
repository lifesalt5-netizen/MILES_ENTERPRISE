"use strict";
const fs=require("fs");const path=require("path");const os=require("os");
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"p2gc-growth-assets-"));process.env.P2GC_GROWTH_ASSET_DIR=tmp;
const svc=require("../SERVICES/growth/P2GCGrowthAssetService");
const checks=[];function add(n,o,d=null){checks.push({name:n,ok:Boolean(o),detail:d});console.log(`[${o?"PASS":"FAIL"}] ${n}${d?` :: ${d}`:""}`)}
const p=svc.add("proposalLibrary",{title:"Executive Growth Proposal Template",tags:["proposal","growth"]}).item;add("proposal library accepts reusable asset",!!p.id,p.id);
const k=svc.add("knowledgeBase",{title:"GO NO-GO Qualification Rule",body:"Mandatory qualifications must pass before prime pursuit."}).item;add("knowledge base accepts governance asset",!!k.id,k.id);
const s=svc.queueSocial({title:"Vehicle Intelligence Insight",body:"Educational LinkedIn draft"}).item;add("social content queue works",s.status==="READY_FOR_APPROVAL",s.status);
const n=svc.add("newsletters",{title:"P2GC Government Growth Brief"}).item;add("newsletter library works",!!n.id,n.id);
const c=svc.add("caseStudies",{title:"Client Growth Case Study"}).item;add("case study library works",!!c.id,c.id);
const l=svc.add("leadMagnets",{title:"Free Government Contracting Readiness Assessment"}).item;add("lead magnet library works",!!l.id,l.id);
const w=svc.queueWebsite({title:"Blueprint landing page",body:"Add demo CTA and lead capture"}).item;add("website improvement queue works",w.status==="READY_FOR_APPROVAL",w.status);
const search=svc.search("qualification");add("growth knowledge search works",search.results.some(x=>x.item.id===k.id),`matches=${search.results.length}`);
const blocked=svc.publish("socialPosts",s.id);add("external social publishing fails closed",blocked.status==="BLOCKED_EXTERNAL_PUBLISHER"&&!blocked.externalPublished,blocked.status);
const dash=svc.dashboard();add("growth asset dashboard aggregates truth",dash.ok&&dash.metrics.proposalLibrary===1&&dash.metrics.leadMagnets===1,JSON.stringify(dash.metrics));
const health=svc.healthCheck();add("LinkedIn/B12/newsletter writes remain governed",health.publishing.linkedin===false&&health.publishing.b12===false&&health.publishing.emailNewsletter===false,health.publishing.status);
const report={ok:checks.every(x=>x.ok),generatedAt:new Date().toISOString(),checks};console.log(`=== P2GC GROWTH ASSETS ACCEPTANCE ${report.ok?"PASS":"FAIL"} ===`);process.exitCode=report.ok?0:1;
