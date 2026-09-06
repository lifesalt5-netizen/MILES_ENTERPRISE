'use strict';

const fs=require('fs');
const path=require('path');
const P2GCMarketingActivityService=require('./P2GCMarketingActivityService');
const P2GCCompanySpecificOutboundPipelineService=require('./P2GCCompanySpecificOutboundPipelineService');

function clean(v){return String(v??'').trim();}
function arr(v){return Array.isArray(v)?v:[];}
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return fallback;}}
function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.${Date.now()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n','utf8');fs.renameSync(tmp,file);}
function safeJson(res,status,body,headers={}){const text=JSON.stringify(body,null,2);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0','X-Robots-Tag':'noindex, nofollow, noarchive, nosnippet','Content-Length':Buffer.byteLength(text),...headers});res.end(text);}
function readBody(req,limit=128*1024){return new Promise((resolve,reject)=>{let raw='';req.on('data',chunk=>{raw+=chunk;if(Buffer.byteLength(raw)>limit){reject(new Error('REQUEST_TOO_LARGE'));try{req.destroy();}catch{}}});req.on('end',()=>{if(!raw.trim())return resolve({});try{resolve(JSON.parse(raw));}catch{reject(new Error('INVALID_JSON'));}});req.on('error',reject);});}

class P2GCPrivateDiagnosticHttpController{
  constructor(options={}){
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,'..','..'));
    this.activity=options.activityService||new P2GCMarketingActivityService({rootDir:this.rootDir});
    this.pipeline=options.pipelineService||new P2GCCompanySpecificOutboundPipelineService({rootDir:this.rootDir,activityService:this.activity});
    this.dataDir=path.join(this.rootDir,'DATA','marketing_activity');
    this.diagnosticFile=path.join(this.dataDir,'diagnostics.json');
    this.pipelineFile=path.join(this.dataDir,'company_specific_pipeline.json');
    this.preCallDir=path.join(this.dataDir,'kevin_pre_call_briefs');
    this.publicDir=path.join(this.rootDir,'SERVICES','private_diagnostic','public');
    this.scheduleUrl=clean(options.scheduleUrl||process.env.P2GC_QUALIFIED_SCHEDULE_URL||'https://www.pathways2gc.com/schedule');
  }

  securityHeaders(contentType){return {'Content-Type':contentType,'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','X-Robots-Tag':'noindex, nofollow, noarchive, nosnippet','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"};}

  lookup(token){
    const value=clean(token);
    if(!/^[A-Za-z0-9_-]{20,}$/.test(value))return {ok:false,code:'DIAGNOSTIC_NOT_FOUND'};
    const diagnostics=readJson(this.diagnosticFile,[]);
    const diagnostic=arr(diagnostics).find(x=>clean(x.token)===value);
    if(!diagnostic)return {ok:false,code:'DIAGNOSTIC_NOT_FOUND'};
    const rows=readJson(this.pipelineFile,[]);
    const pipeline=arr(rows).find(x=>clean(x.diagnosticToken)===value||clean(x.diagnosticId)===clean(diagnostic.id));
    if(!pipeline)return {ok:false,code:'DIAGNOSTIC_NOT_RELEASED'};
    const released=pipeline.positiveReply===true&&Boolean(clean(pipeline.privateLinkReleasedAt))&&['PRIVATE_DIAGNOSTIC_LINK_RELEASED','QUALIFIED_HIGH_INTENT','NURTURE_AFTER_DIAGNOSTIC'].includes(clean(pipeline.status));
    if(!released)return {ok:false,code:'DIAGNOSTIC_NOT_RELEASED'};
    return {ok:true,diagnostic,pipeline};
  }

  publicDiagnostic(diagnostic,pipeline){
    const strongest=arr(diagnostic.strongestFindings).length?arr(diagnostic.strongestFindings):arr(diagnostic.findings).slice(0,3);
    const previewOpportunities=arr(diagnostic.relevantCurrentOpportunities).slice(0,2).map(item=>({
      id:clean(item.id||item.noticeId||item.solicitationNumber),
      title:clean(item.title||item.name),
      agency:clean(item.agency||item.department||item.buyer),
      dueDate:clean(item.dueDate||item.responseDeadline||item.closeDate),
      fit:clean(item.fit||item.qualification||item.pathway)
    })).filter(x=>x.title||x.agency);
    return {
      diagnosticId:diagnostic.id,
      company:diagnostic.company,
      contactFirstName:clean(diagnostic.contact).split(/\s+/)[0]||null,
      preparedAt:diagnostic.createdAt,
      position:{federalStatus:diagnostic.federalStatus||null,gsaStatus:diagnostic.gsaStatus||null,vaStatus:diagnostic.vaStatus||null,sins:arr(diagnostic.sins),naics:arr(diagnostic.naics).slice(0,8),topAgencies:arr(diagnostic.topAgencies).slice(0,5)},
      findings:strongest.slice(0,3).map(f=>({label:clean(f.label||f.type),finding:clean(f.finding),source:clean(f.source),asOfDate:clean(f.asOfDate),metricDefinition:clean(f.metricDefinition)})),
      lockedFindingCount:Math.max(0,arr(diagnostic.findings).length-Math.min(3,strongest.length)),
      pathways:{protect:arr(diagnostic.protect).slice(0,3),expand:arr(diagnostic.expand).slice(0,3),capture:arr(diagnostic.capture).slice(0,3)},
      opportunityPreview:previewOpportunities,
      additionalOpportunitySignals:Math.max(0,arr(diagnostic.relevantCurrentOpportunities).length-previewOpportunities.length),
      qualification:{questions:[
        {id:'goal',label:'What are you trying to accomplish in federal contracting over the next 6–12 months?'},
        {id:'executionPreference',label:'If the findings are valid, how would you prefer to act on them?'},
        {id:'timing',label:'When would you want to start addressing the highest-priority issue?'},
        {id:'willingnessToInvest',label:'If there is a clear, practical path, are you willing to invest in getting it executed?'}
      ],scheduleGated:true},
      privacy:{private:true,recipientRequested:true,linkReleasedAfterPositiveReply:true,noIndex:true},
      pipelineId:pipeline.id
    };
  }

  serveAsset(res,name,contentType){
    const file=path.join(this.publicDir,name);
    if(!fs.existsSync(file)){res.writeHead(404,this.securityHeaders('text/plain; charset=utf-8'));res.end('Not found');return;}
    const body=fs.readFileSync(file);
    res.writeHead(200,{...this.securityHeaders(contentType),'Content-Length':body.length});res.end(body);
  }

  persistPipelineStatus(pipelineId,status,extra={}){
    const rows=readJson(this.pipelineFile,[]);const row=arr(rows).find(x=>clean(x.id)===clean(pipelineId));
    if(!row)return null;
    row.status=status;row.updatedAt=new Date().toISOString();Object.assign(row,extra);writeJson(this.pipelineFile,rows);return row;
  }

  async handle(req,res,url){
    const page=url.pathname.match(/^\/r\/([A-Za-z0-9_-]{20,})$/);
    if(req.method==='GET'&&page){
      const access=this.lookup(page[1]);
      if(!access.ok){res.writeHead(404,this.securityHeaders('text/plain; charset=utf-8'));res.end('This private review is not available.');return true;}
      this.serveAsset(res,'diagnostic.html','text/html; charset=utf-8');return true;
    }
    if(req.method==='GET'&&url.pathname==='/private-diagnostic/diagnostic.js'){this.serveAsset(res,'diagnostic.js','application/javascript; charset=utf-8');return true;}
    if(req.method==='GET'&&url.pathname==='/private-diagnostic/diagnostic.css'){this.serveAsset(res,'diagnostic.css','text/css; charset=utf-8');return true;}

    const api=url.pathname.match(/^\/api\/private-diagnostic\/([A-Za-z0-9_-]{20,})\/(state|event|qualify)$/);
    if(!api)return false;
    const token=api[1],action=api[2];
    const access=this.lookup(token);
    if(!access.ok){safeJson(res,404,{ok:false,status:'DIAGNOSTIC_NOT_AVAILABLE'});return true;}

    try{
      if(req.method==='GET'&&action==='state'){
        this.activity.recordDiagnosticInteraction({diagnosticId:access.diagnostic.id,token,company:access.diagnostic.company,contact:access.diagnostic.contact,event:'OPEN',section:'OVERVIEW',metadata:{pipelineId:access.pipeline.id}});
        safeJson(res,200,{ok:true,status:'PRIVATE_DIAGNOSTIC_READY',diagnostic:this.publicDiagnostic(access.diagnostic,access.pipeline)});return true;
      }
      if(req.method==='POST'&&action==='event'){
        const body=await readBody(req);
        const allowed=new Set(['VIEW','SECTION_VIEW','OPPORTUNITY_OPEN','CTA','QUALIFICATION_START','QUALIFICATION_CHANGE','SCHEDULE_CLICK']);
        const event=clean(body.event||'VIEW').toUpperCase();
        if(!allowed.has(event)){safeJson(res,400,{ok:false,status:'EVENT_NOT_ALLOWED'});return true;}
        const saved=this.activity.recordDiagnosticInteraction({diagnosticId:access.diagnostic.id,token,company:access.diagnostic.company,contact:access.diagnostic.contact,event,section:clean(body.section),opportunityId:clean(body.opportunityId),cta:clean(body.cta),metadata:body.metadata||{}});
        safeJson(res,200,{ok:true,status:'DIAGNOSTIC_INTERACTION_RECORDED',eventId:saved.id});return true;
      }
      if(req.method==='POST'&&action==='qualify'){
        const body=await readBody(req);
        const qualification={
          company:access.diagnostic.company,contact:access.diagnostic.contact,segment:access.pipeline.segment,
          goal:clean(body.goal),executionPreference:clean(body.executionPreference),timing:clean(body.timing),willingnessToInvest:clean(body.willingnessToInvest),
          fullReviewRequested:true,substantiveSalesQuestion:Boolean(clean(body.salesQuestion)),realOpportunity:Boolean(arr(access.diagnostic.relevantCurrentOpportunities).length)
        };
        const decision=this.pipeline.qualification(qualification);
        this.activity.recordDiagnosticInteraction({diagnosticId:access.diagnostic.id,token,company:access.diagnostic.company,contact:access.diagnostic.contact,event:'CTA',section:'QUALIFICATION',cta:'REQUEST_FULL_COMPANY_REVIEW',metadata:{route:decision.route}});
        if(decision.highIntent){
          const brief=this.pipeline.kevinPreCallBrief({pipelineId:access.pipeline.id,qualification});
          if(brief.ok){writeJson(path.join(this.preCallDir,`${access.pipeline.id}.json`),{...brief.brief,qualification,generatedAt:new Date().toISOString(),status:'KEVIN_HANDOFF_READY'});}
          this.persistPipelineStatus(access.pipeline.id,'QUALIFIED_HIGH_INTENT',{qualifiedAt:new Date().toISOString(),qualification,kevinBriefReady:Boolean(brief.ok)});
          this.activity.recordActivity({channel:'SYSTEM',campaign:'PRIVATE_DIAGNOSTIC',segment:access.pipeline.segment,action:'KEVIN_HANDOFF_READY',recipient:access.pipeline.email,status:'QUALIFIED',message:`${access.diagnostic.company} completed the four-question qualification and requested the full company review.`,result:{pipelineId:access.pipeline.id,diagnosticId:access.diagnostic.id,scheduleUrl:this.scheduleUrl,kevinBriefReady:Boolean(brief.ok)}});
          safeJson(res,200,{ok:true,status:'QUALIFIED_FOR_KEVIN',highIntent:true,scheduleAllowed:true,scheduleUrl:this.scheduleUrl,message:'Your answers show enough intent for a focused review with Kevin. Choose a time that works for you.'});return true;
        }
        this.persistPipelineStatus(access.pipeline.id,'NURTURE_AFTER_DIAGNOSTIC',{qualificationSubmittedAt:new Date().toISOString(),qualification});
        safeJson(res,200,{ok:true,status:'CONTINUE_QUALIFICATION_OR_NURTURE',highIntent:false,scheduleAllowed:false,message:'Thanks. P2GC has your priorities and will keep the next step focused on the areas you selected. Kevin’s calendar is reserved for companies ready to evaluate or act on a defined path.'});return true;
      }
      safeJson(res,405,{ok:false,status:'METHOD_NOT_ALLOWED'});return true;
    }catch(error){safeJson(res,error.message==='REQUEST_TOO_LARGE'?413:500,{ok:false,status:'PRIVATE_DIAGNOSTIC_REQUEST_FAILED',error:error.message});return true;}
  }
}

module.exports=P2GCPrivateDiagnosticHttpController;
