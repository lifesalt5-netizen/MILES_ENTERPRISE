'use strict';
const fs=require('fs');
const path=require('path');
const PROVIDERS=[
 {name:'MILLIONVERIFIER',keys:['MILLIONVERIFIER_API_KEY','MILLION_VERIFIER_API_KEY','MILLIONVERIFY_API_KEY']},
 {name:'ZEROBOUNCE',keys:['ZEROBOUNCE_API_KEY']},
 {name:'NEVERBOUNCE',keys:['NEVERBOUNCE_API_KEY']},
 {name:'GENERIC',keys:['EMAIL_VERIFICATION_API_KEY','EMAIL_VALIDATION_API_KEY']}
];
class EmailVerificationReadinessAuditService{
 constructor(options={}){this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||process.cwd());this.env=options.env||process.env;this.reportPath=path.join(this.rootDir,'DATA','orion_refresh','latest_email_verification_readiness.json');}
 run(){const providers=PROVIDERS.map(p=>{const present=p.keys.filter(k=>String(this.env[k]||'').trim()).map(k=>({envName:k,length:String(this.env[k]).trim().length}));return{name:p.name,configured:present.length>0,presentKeys:present};});const configured=providers.filter(p=>p.configured);const blockers=[];if(configured.length===0)blockers.push('NO_EMAIL_VERIFICATION_PROVIDER_CREDENTIAL_DETECTED');const result={ok:true,service:'EMAIL_VERIFICATION_READINESS_AUDIT',generatedAt:new Date().toISOString(),providers,configuredProviderCount:configured.length,credentialValuesExposed:false,blockers,nextStep:configured.length?'VERIFY_PROVIDER_CONNECTIVITY_AND_CREDIT_POLICY_READ_ONLY':'CEO_OR_ADMIN_CONFIGURE_EXISTING_VERIFIER_CREDENTIAL',governance:{doNotPurchaseCreditsAutomatically:true,doNotConsumePaidCreditsWithoutApprovedPolicy:true,verificationRequiredBeforeCampaignEligibility:true,discoveryStatusNeedsVerificationIsNotSendReady:true},safety:{readOnly:true,credentialsModified:false,secretValuesLogged:false,paidVerificationInvoked:false,campaignsModified:false,productionOrionModified:false}};fs.mkdirSync(path.dirname(this.reportPath),{recursive:true});fs.writeFileSync(this.reportPath,JSON.stringify(result,null,2),'utf8');return result;}
}
module.exports=EmailVerificationReadinessAuditService;
