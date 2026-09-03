'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {Writable}=require('stream');
const Access=require('../SERVICES/revenue/P2GCFederalGrowthReviewAccessService');
const Media=require('../SERVICES/revenue/P2GCFederalGrowthReviewMediaService');

class CaptureResponse extends Writable{
  constructor(){super();this.statusCode=null;this.headers={};this.chunks=[];this.ended=false;}
  _write(chunk,enc,cb){this.chunks.push(Buffer.from(chunk));cb();}
  writeHead(status,headers={}){this.statusCode=status;this.headers=headers;return this;}
  end(chunk){if(chunk)this.chunks.push(Buffer.from(chunk));this.ended=true;super.end();}
  body(){return Buffer.concat(this.chunks);}
}
function streamed(media,req,res,context){
  return new Promise((resolve,reject)=>{
    res.once('finish',()=>resolve(res));res.once('error',reject);
    try{media.stream(req,res,context);}catch(error){reject(error);}
  });
}

(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-review-media-'));
  try{
    const access=new Access({secret:'0123456789abcdef0123456789abcdef0123456789abcdef',videoTokenTtlSeconds:300});
    const media=new Media({rootDir:root,access});
    const mediaId='media-test-12345';
    const source=path.join(root,'source.mp4');
    const payload=Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ','utf8');
    fs.writeFileSync(source,payload);
    const registered=media.registerLocalArtifact(mediaId,source);
    assert.equal(registered.ok,true);
    assert.equal(media.exists(mediaId),true);

    const review={reviewId:'P2GC-FGR-STREAM-TEST',expiresAt:new Date(Date.now()+3600000).toISOString(),recipient:{email:'buyer@example.com'}};
    const sessionId='session-abc-123';
    const token=access.createVideoToken(review,'buyer@example.com',sessionId,mediaId);
    const context={reviewId:review.reviewId,authenticatedEmail:'buyer@example.com',sessionId,mediaId,token};

    const fullRes=new CaptureResponse();
    await streamed(media,{headers:{}},fullRes,context);
    assert.equal(fullRes.statusCode,200);
    assert.equal(fullRes.headers['Content-Type'],'video/mp4');
    assert.match(String(fullRes.headers['Cache-Control']),/no-store/);
    assert.match(String(fullRes.headers['X-Robots-Tag']),/noindex/);
    assert.equal(fullRes.headers['Content-Disposition'],'inline');
    assert.deepEqual(fullRes.body(),payload);

    const rangeRes=new CaptureResponse();
    await streamed(media,{headers:{range:'bytes=5-12'}},rangeRes,context);
    assert.equal(rangeRes.statusCode,206);
    assert.equal(rangeRes.headers['Content-Range'],`bytes 5-12/${payload.length}`);
    assert.deepEqual(rangeRes.body(),payload.subarray(5,13));

    const wrongRecipientRes=new CaptureResponse();
    const wrongRecipient=media.stream({headers:{}},wrongRecipientRes,{...context,authenticatedEmail:'other@example.com'});
    assert.equal(wrongRecipient.ok,false);
    assert.equal(wrongRecipientRes.statusCode,403);
    assert.match(String(wrongRecipientRes.headers['Cache-Control']),/no-store/);

    const wrongSessionRes=new CaptureResponse();
    const wrongSession=media.stream({headers:{}},wrongSessionRes,{...context,sessionId:'different-session'});
    assert.equal(wrongSession.ok,false);
    assert.equal(wrongSessionRes.statusCode,403);

    const tamperedRes=new CaptureResponse();
    const tampered=media.stream({headers:{}},tamperedRes,{...context,token:`${token}x`});
    assert.equal(tampered.ok,false);
    assert.equal(tamperedRes.statusCode,403);

    const invalidRangeRes=new CaptureResponse();
    const invalidRange=media.stream({headers:{range:'bytes=999-1000'}},invalidRangeRes,context);
    assert.equal(invalidRange.ok,false);
    assert.equal(invalidRangeRes.statusCode,416);
    assert.equal(invalidRangeRes.headers['Content-Range'],`bytes */${payload.length}`);

    const missingId='media-missing-123';
    const missingToken=access.createVideoToken(review,'buyer@example.com',sessionId,missingId);
    const missingRes=new CaptureResponse();
    const missing=media.stream({headers:{}},missingRes,{reviewId:review.reviewId,authenticatedEmail:'buyer@example.com',sessionId,mediaId:missingId,token:missingToken});
    assert.equal(missing.ok,false);
    assert.equal(missingRes.statusCode,404);

    console.log('P2GC_FEDERAL_GROWTH_REVIEW_MEDIA_STREAM_GREEN');
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
