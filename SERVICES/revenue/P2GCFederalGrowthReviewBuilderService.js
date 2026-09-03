'use strict';

const http = require('http');
const Lifecycle = require('./P2GCFederalGrowthReviewLifecycleService');
const ScriptService = require('./P2GCFederalGrowthReviewScriptService');

function clean(v){ return String(v == null ? '' : v).trim(); }
function finite(v){ return Number.isFinite(Number(v)); }
function pct(v){ return finite(v) ? Math.round(Number(v)) : null; }
function number(v){ return finite(v) ? Number(v) : null; }
function domainFromEmail(email){ return clean(email).toLowerCase().split('@')[1] || null; }
function freshNow(){ return new Date().toISOString(); }

class P2GCFederalGrowthReviewBuilderService {
  constructor(options={}){
    this.rootDir=options.rootDir||process.env.MILES_ROOT||process.cwd();
    this.lifecycle=options.lifecycle||new Lifecycle({rootDir:this.rootDir});
    this.scriptService=options.scriptService||new ScriptService();
    this.assessmentHost=options.assessmentHost||'127.0.0.1';
    this.assessmentPort=Number(options.assessmentPort||process.env.P2GC_GROWTH_DEMO_PORT||8791);
    this.requestTimeoutMs=Math.max(10000,Number(options.requestTimeoutMs||120000));
    this.fetchAssessment=options.fetchAssessment||((term,refresh)=>this.requestAssessment(term,refresh));
  }

  requestAssessment(term,refresh=false){
    return new Promise((resolve,reject)=>{
      const pathname=`/api/assessment?term=${encodeURIComponent(clean(term))}${refresh?'&refresh=1':''}`;
      const req=http.get({host:this.assessmentHost,port:this.assessmentPort,path:pathname,timeout:this.requestTimeoutMs},res=>{
        const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{
          const raw=Buffer.concat(chunks).toString('utf8');
          let body;try{body=JSON.parse(raw);}catch{return reject(new Error('CANONICAL_ASSESSMENT_INVALID_JSON'));}
          if(res.statusCode<200||res.statusCode>=300||body?.ok!==true)return reject(new Error(`CANONICAL_ASSESSMENT_FAILED:${body?.status||res.statusCode}`));
          resolve(body);
        });
      });
      req.on('timeout',()=>req.destroy(new Error('CANONICAL_ASSESSMENT_TIMEOUT')));req.on('error',reject);
    });
  }

  evidence(model,key,fallback={}){
    const explicit=model?.evidence?.[key]||null;
    return {
      source:clean(explicit?.authority||explicit?.source||explicit?.sourceName||fallback.source||'P2GC_CANONICAL_CURRENT_TRUTH'),
      freshness:clean(explicit?.retrievedAt||explicit?.generatedAt||explicit?.asOfDate||fallback.freshness||''),
      confidence:clean(explicit?.confidence||fallback.confidence||'HIGH'),
      verificationState:clean(explicit?.verificationState||fallback.verificationState||'CONFIRMED')
    };
  }

  add(findings,section,title,finding,whatItMeans,whyItMatters,businessImpact,howP2GCAddressesIt,evidence,extra={}){
    if(!clean(title)||!clean(finding))return false;
    if(!evidence||!clean(evidence.source)||!clean(evidence.freshness)||!clean(evidence.confidence)||!clean(evidence.verificationState))return false;
    findings.push({
      id:`finding-${findings.length+1}`,
      section,title,finding,whatItMeans,whyItMatters,businessImpact,howP2GCAddressesIt,
      source:evidence.source,freshness:evidence.freshness,confidence:evidence.confidence,verificationState:evidence.verificationState,
      material:true,freePreviewVisibility:extra.freePreviewVisibility||'REPRESENTATIVE',active:extra.active,expired:extra.expired
    });
    return true;
  }

  buildFindings(model){
    const f=[];const profile=model.profile||{};const proof=model.commercialPreview?.totals||{};
    const samEvidence=this.evidence(model,'currentSamRegistration',{source:'SAM.gov current registration'});
    if(clean(profile.samStatus)){
      this.add(f,'CURRENT_GOVERNMENT_POSITION','SAM registration position',`${profile.companyName||'The company'} is shown with SAM status ${profile.samStatus}${profile.uei?` and UEI ${profile.uei}`:''}.`,'This establishes the current registration baseline used for federal-market analysis.','Registration is a prerequisite for many federal actions, but registration by itself is not evidence of contract performance.','A current registration supports pursuit readiness; any registration gap can stop otherwise viable pursuits.','P2GC uses the verified registration state as one input to determine what federal actions are actually available.',samEvidence);
    }

    const awards=model.awardHistory||{};
    const awardCount=number(awards.totalAwards??awards.confirmedAwardCount??awards.records?.length);
    const awardValue=number(awards.totalPrimeAwardValue??awards.reportedPrimeAwardValue??awards.totalValue);
    if(awardCount!==null&&awardCount>0){
      const e=this.evidence(model,'awardHistory',{source:'USAspending / authoritative award history'});
      this.add(f,'AWARD_REVENUE_POSITION','Confirmed federal award history',`${profile.companyName||'The company'} has ${awardCount.toLocaleString()} confirmed award record${awardCount===1?'':'s'}${awardValue!==null?` with reported prime award value of approximately $${Math.round(awardValue).toLocaleString()}`:''}.`,'The company has documented federal-performance history rather than registration-only presence.','Existing performance can materially change buyer positioning, recompete strategy, teaming credibility, and the type of growth work that should be prioritized.','The growth question becomes how effectively that history is being converted into current and future pipeline, not simply how to enter the market.','P2GC maps the verified award history to agencies, capabilities, vehicles, recompetes, and acquisition paths while keeping prime and subcontract performance distinct.',e);
    }

    const vehicleRecords=model.vehicles?.records||model.profile?.gsaContracts||[];
    const vehicleCount=number(model.vehicles?.count??model.vehicles?.currentCount??vehicleRecords.length);
    if(vehicleCount!==null&&vehicleCount>0){
      const names=vehicleRecords.slice(0,3).map(x=>clean(x.vehicleFamily||x.scheduleNumber||x.contractNumber||x.title)).filter(Boolean);
      const e=this.evidence(model,'currentGsaHolderTruth',{source:'Official federal vehicle source'});
      this.add(f,'VEHICLE_GSA_VA_POSITION','Verified federal contract vehicle access',`${profile.companyName||'The company'} has ${vehicleCount} verified current federal vehicle holding${vehicleCount===1?'':'s'}${names.length?`, including ${names.join(', ')}`:''}.`,'Vehicle ownership is an access fact; it is not the same thing as sales performance on that vehicle.','A useful vehicle strategy must distinguish existing access, actual utilization, and a specific missing access path tied to buyers or opportunities.','Treating every contractor as having a generic “vehicle gap” can create the wrong investment decision.','P2GC evaluates current holdings and performance separately and recommends expansion only when a specific validated acquisition path requires it.',e);
    }

    const opportunity=model.opportunities||{};const discovered=number(opportunity.qualification?.discovered??opportunity.total??opportunity.liveAndForecast?.length??proof.opportunities?.total);
    if(discovered!==null&&discovered>0){
      const q=opportunity.qualification||{};const direct=number(q.directFitSupported??proof.opportunities?.directFitSupported);const near=number(q.nearFitGapClosable??proof.opportunities?.nearFitGapClosable);const validation=number(q.capabilityValidationRequired??proof.opportunities?.capabilityValidationRequired);const teaming=number(q.teamingPathSupported??proof.opportunities?.teamingPathSupported);
      const parts=[`${discovered} current opportunity candidate${discovered===1?'':'s'} discovered`];
      if(direct!==null)parts.push(`${direct} direct-fit supported`);if(near!==null)parts.push(`${near} near-fit/gap-closable`);if(teaming!==null)parts.push(`${teaming} teaming/access`);if(validation!==null)parts.push(`${validation} requiring qualification validation`);
      const e=this.evidence(model,'currentPublicOpportunities',{source:'Current public opportunity sources'});
      this.add(f,'OPPORTUNITY_ENVIRONMENT','Current opportunity environment',parts.join(' • ')+'.','Discovery and qualification are deliberately separate. A keyword or NAICS match is only a candidate until solicitation-specific requirements and company evidence support the pursuit.','This prevents the company from treating broad search results as bid-ready opportunities and makes capability gaps visible before resources are committed.','The practical value is a smaller, more defensible pursuit set and earlier identification of requirements that can be closed internally or through a partner.','ORION discovers broadly; P2GC then validates solicitation requirements, company evidence, access, eligibility, and gap-closure paths before recommending pursuit.',e);
    }

    const recompetes=model.recompetes||{};const recompeteCount=number(recompetes.total??recompetes.count??proof.recompetes?.total);
    if(recompeteCount!==null&&recompeteCount>0){
      const e=this.evidence(model,'recompeteSignals',{source:'ORION recompete evidence'});
      this.add(f,'RECOMPETE_REVENUE_EXPOSURE','Recompete and incumbent-displacement signals',`${recompeteCount} recompete or incumbent-displacement signal${recompeteCount===1?' is':'s are'} currently identified for review.`,'These are timing and positioning signals, not guarantees that the company owns or can win the underlying requirement.','Recompetes can create earlier capture windows than waiting for a solicitation to appear, but incumbent identity, requirement continuity, and qualification must be validated.','Properly validated recompete intelligence can improve timing and reduce last-minute capture behavior.','P2GC validates the relationship to the company, requirement continuity, timing, competition, and appropriate capture path before recommending action.',e);
    }

    const primeCount=number(model.primePartners?.records?.length??proof.primePartners?.total);
    if(primeCount!==null&&primeCount>0){
      const e=this.evidence(model,'primeSubIntelligence',{source:'P2GC prime/sub intelligence'});
      this.add(f,'PRIME_SUB_POSITION','Prime and teaming environment',`${primeCount} prime or teaming candidate${primeCount===1?' is':'s are'} available for further validation.`,'A potential partner is useful only when its vehicle, agency, capability, or past-performance position closes a real access or qualification need.','Generic partner lists create activity without a clear pursuit rationale.','A validated partner path can unlock otherwise inaccessible work while preserving a defensible role for the company.','P2GC ties teaming recommendations to the actual opportunity/access gap and withholds the complete partner-target list for the paid execution engagement.',e,{freePreviewVisibility:'REPRESENTATIVE'});
    }

    const readiness=pct(model.readiness?.overall);
    if(readiness!==null){
      const e=this.evidence(model,'truthIntegrity',{source:'P2GC canonical evidence reconciliation'});
      this.add(f,'P2GC_DIAGNOSIS','Federal growth readiness diagnosis',`The current evidence-backed readiness score is ${readiness}/100.`,'The score summarizes the verified current position; it is not a prediction of award probability.','The value of the diagnosis is identifying which constraints are factual and actionable versus merely unknown.','Prioritizing evidence-backed constraints focuses time and spending on issues that can materially change federal growth readiness.','P2GC converts the diagnosis into a validated pathway and execution scope while keeping unknown data from being treated as zero.',e);
    }

    const rec=model.recommendations||model.recommendationEngine||{};
    const next=clean(rec.primaryRecommendation||rec.primary||model.nextBestAction?.title||model.diagnosis?.recommendedPathway);
    if(next){
      const e=this.evidence(model,'truthIntegrity',{source:'P2GC canonical recommendation policy'});
      this.add(f,'RECOMMENDED_P2GC_PATHWAY','Recommended P2GC pathway',next,'This is the current recommended direction based on the evidence available now.','The recommendation should change if the underlying authoritative evidence changes; it is not a generic template.','A validated pathway narrows the immediate decision and avoids buying work that does not address the actual constraint.','P2GC turns the validated direction into the appropriate scoped engagement after Kevin reviews the findings with the company.',e);
    }

    return f;
  }

  async createFromAssessment(input={}){
    const term=clean(input.term||input.companyName||input.uei||input.cage||input.website);
    const recipientEmail=clean(input.recipientEmail).toLowerCase();
    if(!term)throw new Error('COMPANY_TERM_REQUIRED');if(!recipientEmail)throw new Error('RECIPIENT_EMAIL_REQUIRED');
    const model=await this.fetchAssessment(term,input.refresh===true);
    const companyName=clean(model?.profile?.companyName||model?.company?.company);
    if(!companyName)throw new Error('CANONICAL_COMPANY_NAME_UNAVAILABLE');
    const truthCheckedAt=clean(model?.truthIntegrity?.checkedAt);
    if(!truthCheckedAt)throw new Error('CANONICAL_TRUTH_FRESHNESS_REQUIRED');
    const findings=this.buildFindings(model);
    if(!findings.length)throw new Error('NO_VERIFIED_REVIEW_FINDINGS_AVAILABLE');
    let review=this.lifecycle.createReview({
      company:{name:companyName,uei:model.profile?.uei||null,cage:model.profile?.cage||null,domain:clean(input.companyDomain||domainFromEmail(recipientEmail))},
      recipient:{email:recipientEmail,name:clean(input.recipientName)||null,companyDomain:clean(input.companyDomain||domainFromEmail(recipientEmail))},
      expirationHours:input.expirationHours||72
    });
    this.lifecycle.completeStage(review.reviewId,'PROSPECT_INTAKE',{source:'P2GC_REVIEW_INTAKE',freshness:freshNow(),confidence:'HIGH',verificationState:'CONFIRMED'});
    this.lifecycle.completeStage(review.reviewId,'COMPANY_RESOLUTION',{source:'P2GC_CANONICAL_ASSESSMENT',freshness:truthCheckedAt,confidence:'HIGH',verificationState:'CONFIRMED',notes:`Resolved to ${companyName}${model.profile?.uei?` / ${model.profile.uei}`:''}`});
    this.lifecycle.completeStage(review.reviewId,'VERIFIED_INTELLIGENCE',{source:'P2GC_CANONICAL_CURRENT_TRUTH',freshness:truthCheckedAt,confidence:'HIGH',verificationState:clean(model.truthIntegrity?.status||'CONFIRMED')});
    for(const finding of findings)this.lifecycle.addFinding(review.reviewId,finding);
    this.lifecycle.completeStage(review.reviewId,'ACCURATE_FINDINGS',{source:'P2GC_REVIEW_BUILDER',freshness:freshNow(),confidence:'HIGH',verificationState:'CONFIRMED',notes:`${findings.length} material findings with source-specific freshness`});
    review=this.lifecycle.read(review.reviewId);
    const script=this.scriptService.build({company:review.company,findings:review.findings});
    review.presentation={
      advisorRole:script.advisorRole,
      scriptStatus:script.status,
      sections:script.sections,
      script:script.fullText,
      runtime:{estimatedMinutes:script.estimatedRuntimeMinutes,target:script.runtimeTarget,status:script.runtimeStatus,display:`Estimated runtime: ${script.estimatedRuntimeMinutes} minutes`},
      videoStatus:'PENDING',
      mediaId:null,
      generatedAt:script.generatedAt
    };
    review.priorityOptions=script.priorityOptions;
    this.lifecycle.write(review);
    this.lifecycle.completeStage(review.reviewId,'PERSONALIZED_SCRIPT',{source:'P2GC_FEDERAL_GROWTH_REVIEW_SCRIPT_SERVICE',freshness:script.generatedAt,confidence:'HIGH',verificationState:'CONFIRMED',notes:`Runtime ${script.estimatedRuntimeMinutes} minutes / ${script.runtimeStatus}`});
    review=this.lifecycle.read(review.reviewId);
    return {
      ok:true,status:'P2GC_PERSONALIZED_FEDERAL_GROWTH_REVIEW_DRAFT_READY',reviewId:review.reviewId,company:review.company,recipient:review.recipient,expiresAt:review.expiresAt,
      findingCount:review.findings.length,priorityOptions:review.priorityOptions,runtime:review.presentation?.runtime,advisorRole:review.presentation?.advisorRole,
      truthStatus:model.truthIntegrity?.status||null,sourceAssessment:{uei:model.profile?.uei||null,cage:model.profile?.cage||null,readiness:model.readiness?.overall??null},
      nextRequiredStage:'PROFESSIONAL_AI_DEMO',green:false
    };
  }
}

module.exports=P2GCFederalGrowthReviewBuilderService;
