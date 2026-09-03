'use strict';

const Builder=require('./P2GCFederalGrowthReviewBuilderService');
const Release=require('./P2GCFederalGrowthReviewReleaseService');
const VideoProvider=require('./P2GCFederalGrowthReviewVideoProviderService');

function json(res,status,body){const text=JSON.stringify(body,null,2);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive, nosnippet','Content-Length':Buffer.byteLength(text)});res.end(text);}
function clean(v){return String(v==null?'':v).trim();}
function isLoopbackAddress(v){const x=clean(v).toLowerCase();return x==='127.0.0.1'||x==='::1'||x==='::ffff:127.0.0.1';}
function readBody(req){return new Promise((resolve,reject)=>{let data='';req.on('data',c=>{data+=c;if(data.length>1024*1024){reject(new Error('ADMIN_REQUEST_TOO_LARGE'));req.destroy();}});req.on('end',()=>{if(!data)return resolve({});try{resolve(JSON.parse(data));}catch{reject(new Error('ADMIN_INVALID_JSON'));}});req.on('error',reject);});}

class P2GCFederalGrowthReviewAdminController{
  constructor(options={}){
    this.rootDir=options.rootDir||process.env.MILES_ROOT||process.cwd();
    this.builder=options.builder||new Builder({rootDir:this.rootDir});
    this.release=options.release||new Release({rootDir:this.rootDir});
    this.lifecycle=this.release.lifecycle;
    this.videoProvider=options.videoProvider||new VideoProvider({rootDir:this.rootDir,lifecycle:this.lifecycle});
  }

  authorized(req){
    const remote=req?.socket?.remoteAddress||req?.connection?.remoteAddress||'';
    const forwarded=clean(req?.headers?.['x-forwarded-for']||req?.headers?.['forwarded']||req?.headers?.['x-real-ip']);
    return isLoopbackAddress(remote)&&!forwarded;
  }

  async handle(req,res,url){
    if(!url.pathname.startsWith('/api/admin/review'))return false;
    if(!this.authorized(req)){json(res,403,{ok:false,status:'ADMIN_REVIEW_LOOPBACK_ONLY'});return true;}
    try{
      if(req.method==='GET'&&url.pathname==='/api/admin/review/health'){
        json(res,200,{ok:true,status:'P2GC_REVIEW_ADMIN_PRIVATE_READY',loopbackOnly:true,externalSendRequires:'KEVIN_APPROVED_SEND',videoProviderGate:true});return true;
      }
      if(req.method==='GET'&&url.pathname==='/api/admin/review/video-readiness'){
        const provider=this.videoProvider.selectProvider();json(res,200,{ok:true,status:'P2GC_REVIEW_VIDEO_PROVIDER_READINESS',provider,sendPerformed:false,videoGenerated:false});return true;
      }
      if(req.method==='GET'&&url.pathname==='/api/admin/review/status'){
        const reviewId=clean(url.searchParams.get('reviewId'));const record=this.lifecycle.read(reviewId);if(!record){json(res,404,{ok:false,status:'REVIEW_NOT_FOUND'});return true;}
        json(res,200,{ok:true,status:'P2GC_REVIEW_ADMIN_STATUS',review:record,greenGate:this.lifecycle.getGreenGate(reviewId)});return true;
      }
      if(req.method!=='POST'){json(res,405,{ok:false,status:'METHOD_NOT_ALLOWED'});return true;}
      const body=await readBody(req);
      if(url.pathname==='/api/admin/review/draft'){
        const out=await this.builder.createFromAssessment(body);json(res,200,out);return true;
      }
      const reviewId=clean(body.reviewId);if(!reviewId){json(res,400,{ok:false,status:'REVIEW_ID_REQUIRED'});return true;}
      if(url.pathname==='/api/admin/review/video-prepare'){
        const out=this.videoProvider.prepareReview(reviewId);json(res,out.ok?200:409,{...out,videoGenerated:false});return true;
      }
      if(url.pathname==='/api/admin/review/video-ready'){
        const out=this.videoProvider.markVideoReady(reviewId,{provider:body.provider,mediaId:body.mediaId,durationSeconds:body.durationSeconds});json(res,200,out);return true;
      }
      if(url.pathname==='/api/admin/review/decision'){
        const record=this.release.applyDecision(reviewId,body.decision,body.notes);json(res,200,{ok:true,status:'KEVIN_REVIEW_DECISION_RECORDED',reviewId,decision:record.release?.decision,state:record.status,approvedByKevin:record.release?.approvedByKevin===true});return true;
      }
      if(url.pathname==='/api/admin/review/secure-link'){
        const out=this.release.createSecureLink(reviewId,{ttlSeconds:body.ttlSeconds});json(res,200,{...out,internalOnly:true});return true;
      }
      if(url.pathname==='/api/admin/review/email-preview'){
        const secureLink=clean(body.secureLink);if(!secureLink){json(res,400,{ok:false,status:'SECURE_LINK_REQUIRED'});return true;}const draft=this.release.emailDraft(reviewId,secureLink);json(res,200,{ok:true,status:'P2GC_REVIEW_EMAIL_PREVIEW',draft,sendPerformed:false});return true;
      }
      if(url.pathname==='/api/admin/review/manual-send-record'){
        const secureLinkId=clean(body.secureLinkId);if(!secureLinkId){json(res,400,{ok:false,status:'SECURE_LINK_ID_REQUIRED'});return true;}const record=this.release.recordManualSend(reviewId,secureLinkId);json(res,200,{ok:true,status:'MANUAL_SEND_RECORDED',reviewId,sentAt:record.release?.sentAt||null,deliveryConfirmed:false});return true;
      }
      if(url.pathname==='/api/admin/review/send'){
        if(clean(body.authorization)!=='KEVIN_APPROVED_SEND'){json(res,403,{ok:false,status:'EXPLICIT_KEVIN_SEND_AUTHORIZATION_REQUIRED',requiredAuthorization:'KEVIN_APPROVED_SEND',sendPerformed:false});return true;}
        const out=await this.release.sendApprovedReview(reviewId,{secureLink:body.secureLink,secureLinkId:body.secureLinkId,ttlSeconds:body.ttlSeconds});json(res,200,out);return true;
      }
      json(res,404,{ok:false,status:'ADMIN_REVIEW_ROUTE_NOT_FOUND'});return true;
    }catch(error){json(res,400,{ok:false,status:'ADMIN_REVIEW_ERROR',error:error.message});return true;}
  }
}

module.exports=P2GCFederalGrowthReviewAdminController;
