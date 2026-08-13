'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

process.env.MILES_DRY_RUN = 'true';
process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = 'false';
process.env.MILES_CONTROLLED_WRITE_ENABLED = 'false';

const ROOT = process.env.MILES_ROOT || process.cwd();
const INPUT = path.join(ROOT,'DATA','OUTBOUND','FEDERAL_VA_FSS_GOVERNED','FEDERAL_VA_FSS_REVENUE_ENRICHED.csv');
const MASTER_JSON = path.join(ROOT,'DATA','OUTBOUND','INSTANTLY_MASTER_RECONCILIATION','MASTER_INSTANTLY_RECONCILIATION_LATEST.json');
const OUT_DIR = path.join(ROOT,'DATA','OUTBOUND','FEDERAL_VA_FSS_GOVERNED');
const OUTPUT = path.join(OUT_DIR,'FEDERAL_VA_FSS_CAMPAIGN_ASSIGNMENT_PLAN.csv');
const SUMMARY = path.join(OUT_DIR,'FEDERAL_VA_FSS_CAMPAIGN_ASSIGNMENT_SUMMARY.json');

function norm(v){return String(v??'').trim();}
function lower(v){return norm(v).toLowerCase();}
function parseCsvLine(line){const out=[];let cur='';let q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(ch===','&&!q){out.push(cur);cur='';}else cur+=ch;}out.push(cur);return out;}
function readCsv(file){const lines=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());if(lines.length<2)return[];const h=parseCsvLine(lines[0]);return lines.slice(1).map(line=>{const v=parseCsvLine(line);const r={};h.forEach((x,i)=>r[x]=v[i]??'');return r;});}
function esc(v){const s=String(v??'');return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function writeCsv(file,rows,headers){const lines=[headers.join(',')];for(const r of rows)lines.push(headers.map(h=>esc(r[h])).join(','));fs.writeFileSync(file,lines.join('\n'),'utf8');}

const BUCKET_TO_CAMPAIGN = {
  VA_NO_SALES: 'VA No Sales',
  VA_0_TO_500K: 'VA 0-500k',
  VA_501K_TO_LT3M: 'VA 501k-3m',
  VA_3_TO_LT5M: 'VA 3-5m',
  VA_5M_PLUS: 'VA 5m+'
};

function run(){
  if(!fs.existsSync(INPUT)) throw new Error(`Missing enriched VA/FSS file: ${INPUT}`);
  if(!fs.existsSync(MASTER_JSON)) throw new Error(`Missing Instantly reconciliation: ${MASTER_JSON}`);

  const rows=readCsv(INPUT);
  const snapshot=JSON.parse(fs.readFileSync(MASTER_JSON,'utf8'));
  const campaigns=Array.isArray(snapshot.campaigns)?snapshot.campaigns:[];
  const byName=new Map(campaigns.map(c=>[lower(c.campaignName),c]));

  const summary={
    inputRows:rows.length,
    exactMapped:0,
    blockedUnknownRevenue:0,
    blockedMissingCampaign:0,
    mappedByBucket:{},
    campaignState:{},
    missingCampaignNames:[]
  };

  const out=rows.map(row=>{
    const bucket=norm(row.va_fss_campaign_bucket);
    const wanted=BUCKET_TO_CAMPAIGN[bucket]||'';
    let status='BLOCKED_UNKNOWN_REVENUE';
    let campaign=null;

    if(wanted){
      campaign=byName.get(lower(wanted))||null;
      if(campaign){
        status='EXACT_EXISTING_CAMPAIGN';
        summary.exactMapped++;
        summary.mappedByBucket[bucket]=(summary.mappedByBucket[bucket]||0)+1;
        summary.campaignState[wanted]={
          campaignId:campaign.campaignId||campaign.id||'',
          statusLabel:campaign.statusLabel||campaign.status||null,
          existingMemberships:campaign.leadCount??null,
          senderEmails:campaign.senderEmails||[]
        };
      }else{
        status='BLOCKED_MISSING_CAMPAIGN';
        summary.blockedMissingCampaign++;
        if(!summary.missingCampaignNames.includes(wanted)) summary.missingCampaignNames.push(wanted);
      }
    }else{
      summary.blockedUnknownRevenue++;
    }

    return {
      namespace:'FEDERAL_VA_FSS',
      vendor:row.vendor||row.Vendor||'',
      contract_number:row.contract_number||row['Contract #']||'',
      sam_uei:row.sam_uei||row['SAM UEI']||row.orion_uei||'',
      email:row.email||row.Email||'',
      federal_revenue:row.federal_revenue||'',
      award_count:row.award_count||'',
      va_fss_campaign_bucket:bucket,
      proposed_campaign:wanted,
      proposed_campaign_id:campaign?.campaignId||campaign?.id||'',
      campaign_status:campaign?.statusLabel||campaign?.status||'',
      existing_campaign_memberships:campaign?.leadCount??'',
      sender_emails:(campaign?.senderEmails||[]).join(' | '),
      mapping_status:status,
      write_status:'READ_ONLY_PLAN_ONLY'
    };
  });

  fs.mkdirSync(OUT_DIR,{recursive:true});
  const headers=Object.keys(out[0]||{});
  writeCsv(OUTPUT,out,headers);

  const result={
    ok:true,
    gate:'FEDERAL_VA_FSS_CAMPAIGN_ASSIGNMENT_READ_ONLY',
    generatedAt:new Date().toISOString(),
    namespace:'FEDERAL_VA_FSS',
    stateVirginiaSledExcluded:true,
    totals:{
      inputRows:summary.inputRows,
      exactMapped:summary.exactMapped,
      blockedUnknownRevenue:summary.blockedUnknownRevenue,
      blockedMissingCampaign:summary.blockedMissingCampaign
    },
    mappedByBucket:summary.mappedByBucket,
    campaignState:summary.campaignState,
    missingCampaignNames:summary.missingCampaignNames,
    safety:{readOnly:true,writesToInstantly:false,campaignMutations:false,uploads:false,activations:false,deletes:false},
    outputCsv:OUTPUT,
    nextAction: summary.blockedMissingCampaign>0 ? 'CREATE_OR_REUSE_MISSING_VA_CAMPAIGNS_AFTER_APPROVAL' : 'REVIEW_UNKNOWN_REVENUE_AND_CAMPAIGN_STATES_THEN_BUILD_WRITE_GATE'
  };

  fs.writeFileSync(SUMMARY,JSON.stringify(result,null,2),'utf8');
  console.log(JSON.stringify(result,null,2));
}

try{run();}catch(e){console.error(e.stack||e);process.exitCode=1;}
