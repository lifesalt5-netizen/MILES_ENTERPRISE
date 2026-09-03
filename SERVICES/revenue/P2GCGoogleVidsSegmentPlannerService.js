'use strict';

function clean(v){return String(v==null?'':v).trim().replace(/\s+/g,' ');}
function words(v){return clean(v)?clean(v).split(/\s+/).length:0;}
function sentences(text){
  const normalized=clean(text);if(!normalized)return[];
  const parts=normalized.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g)||[normalized];
  return parts.map(clean).filter(Boolean);
}
function splitLongSentence(sentence,maxWords){
  const tokens=clean(sentence).split(/\s+/);const out=[];
  for(let i=0;i<tokens.length;i+=maxWords)out.push(tokens.slice(i,i+maxWords).join(' '));
  return out;
}

class P2GCGoogleVidsSegmentPlannerService{
  constructor(options={}){
    this.wordsPerMinute=Number(options.wordsPerMinute||135);
    this.maxSeconds=Math.min(58,Math.max(30,Number(options.maxSeconds||55)));
    this.maxWords=Math.max(55,Math.floor(this.wordsPerMinute*this.maxSeconds/60));
    this.advisorName=options.advisorName||'P2GC Federal Growth Advisor';
  }

  scriptText(presentation={}){
    if(clean(presentation.script))return clean(presentation.script);
    if(Array.isArray(presentation.sections))return presentation.sections.map(s=>clean(s.script||s.text||s.content)).filter(Boolean).join(' ');
    return '';
  }

  plan(presentation={}){
    const text=this.scriptText(presentation);if(!text)throw new Error('PERSONALIZED_REVIEW_SCRIPT_REQUIRED');
    const units=[];
    for(const sentence of sentences(text)){
      if(words(sentence)<=this.maxWords)units.push(sentence);
      else units.push(...splitLongSentence(sentence,this.maxWords));
    }
    const segments=[];let current=[];let currentWords=0;
    const flush=()=>{if(!current.length)return;const segmentText=current.join(' ');const wc=words(segmentText);segments.push({index:segments.length+1,text:segmentText,wordCount:wc,estimatedSeconds:Math.ceil(wc/this.wordsPerMinute*60),advisor:this.advisorName});current=[];currentWords=0;};
    for(const unit of units){const wc=words(unit);if(currentWords&&currentWords+wc>this.maxWords)flush();current.push(unit);currentWords+=wc;}flush();
    const totalWords=segments.reduce((n,s)=>n+s.wordCount,0);const estimatedSeconds=Math.ceil(totalWords/this.wordsPerMinute*60);
    return {
      ok:true,
      provider:'GOOGLE_VIDS',
      advisor:this.advisorName,
      constraints:{maxAvatarSeconds:this.maxSeconds,maxWordsPerSegment:this.maxWords,wordsPerMinute:this.wordsPerMinute},
      segments,
      segmentCount:segments.length,
      totalWords,
      estimatedSeconds,
      estimatedMinutes:Number((estimatedSeconds/60).toFixed(1)),
      allSegmentsWithinLimit:segments.every(s=>s.estimatedSeconds<=this.maxSeconds+1),
      generationPolicy:{oneAvatarGenerationPerSegment:true,generateOnlyAfterProviderProven:true,paidActionAllowed:false}
    };
  }
}

module.exports=P2GCGoogleVidsSegmentPlannerService;
