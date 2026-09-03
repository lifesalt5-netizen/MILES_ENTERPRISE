'use strict';

const fs=require('fs');
const path=require('path');

function clean(v){return String(v==null?'':v).trim();}
function safeMediaId(v){const id=clean(v);if(!/^[A-Za-z0-9._-]{8,160}$/.test(id))throw new Error('INVALID_MEDIA_ID');return id;}

class P2GCFederalGrowthReviewMediaService{
  constructor(options={}){
    this.rootDir=options.rootDir||process.env.MILES_ROOT||process.cwd();
    this.mediaDir=options.mediaDir||path.join(this.rootDir,'DATA','federal_growth_review_media');
    this.access=options.access||null;
  }

  ensureDir(){fs.mkdirSync(this.mediaDir,{recursive:true});}
  mediaPath(mediaId){this.ensureDir();return path.join(this.mediaDir,`${safeMediaId(mediaId)}.mp4`);}
  exists(mediaId){try{return fs.statSync(this.mediaPath(mediaId)).isFile();}catch{return false;}}

  registerLocalArtifact(mediaId,sourcePath){
    const source=path.resolve(clean(sourcePath));if(!source||!fs.existsSync(source)||!fs.statSync(source).isFile())throw new Error('VIDEO_ARTIFACT_FILE_REQUIRED');
    if(path.extname(source).toLowerCase()!=='.mp4')throw new Error('VIDEO_ARTIFACT_MUST_BE_MP4');
    const destination=this.mediaPath(mediaId);fs.copyFileSync(source,destination);
    const stat=fs.statSync(destination);
    return{ok:true,status:'PRIVATE_REVIEW_MEDIA_REGISTERED',mediaId:safeMediaId(mediaId),bytes:stat.size,storedAt:new Date().toISOString()};
  }

  stream(req,res,context={}){
    if(!this.access)throw new Error('ACCESS_SERVICE_REQUIRED');
    const reviewId=clean(context.reviewId);const authenticatedEmail=clean(context.authenticatedEmail).toLowerCase();const sessionId=clean(context.sessionId);const expectedMediaId=safeMediaId(context.mediaId);const token=clean(context.token);
    const verified=this.access.validateVideoToken(token,{reviewId,authenticatedEmail,sessionId,mediaId:expectedMediaId});
    if(!verified.ok){res.writeHead(403,{'Cache-Control':'private, no-store, max-age=0','X-Robots-Tag':'noindex, nofollow, noarchive, nosnippet'});res.end('Forbidden');return{ok:false,status:verified.reason};}
    const file=this.mediaPath(expectedMediaId);if(!fs.existsSync(file)){res.writeHead(404,{'Cache-Control':'private, no-store, max-age=0'});res.end('Not found');return{ok:false,status:'PRIVATE_MEDIA_NOT_FOUND'};}
    const stat=fs.statSync(file);const total=stat.size;const range=clean(req.headers.range);
    const headers={'Content-Type':'video/mp4','Accept-Ranges':'bytes','Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Content-Disposition':'inline','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, noarchive, nosnippet','Referrer-Policy':'no-referrer'};
    if(range){
      const match=range.match(/^bytes=(\d*)-(\d*)$/);if(!match){res.writeHead(416,{...headers,'Content-Range':`bytes */${total}`});res.end();return{ok:false,status:'INVALID_RANGE'};}
      let start=match[1]?Number(match[1]):0;let end=match[2]?Number(match[2]):total-1;
      if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||start>=total){res.writeHead(416,{...headers,'Content-Range':`bytes */${total}`});res.end();return{ok:false,status:'INVALID_RANGE'};}
      end=Math.min(end,total-1);const length=end-start+1;res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${total}`,'Content-Length':length});fs.createReadStream(file,{start,end}).pipe(res);return{ok:true,status:'PRIVATE_MEDIA_RANGE_STREAM',start,end,total};
    }
    res.writeHead(200,{...headers,'Content-Length':total});fs.createReadStream(file).pipe(res);return{ok:true,status:'PRIVATE_MEDIA_STREAM',total};
  }
}

module.exports=P2GCFederalGrowthReviewMediaService;
