'use strict';
const assert = require('assert');
const { capabilityAssessment, compatibleSetAside, qualificationTier } = require('../SERVICES/demo/CurrentPublicOpportunityMatchService');

const baseModel = {
  profile:{
    naicsCodes:['541511','541512','541519','561210','493110','611430'],
    certifications:[],
    gsaContracts:[{ categories:['54151S','541612HC','611430TD','OLM'] }]
  },
  awardHistory:{
    primeAwards:[
      { description:'Software and information technology support services' },
      { description:'Warehousing distribution and commodity delivery support' },
      { description:'Agricultural commodity beans food supply' }
    ]
  }
};

const maintenance = capabilityAssessment('Preventive Maintenance and Repair Services - Kahuku Training Area (KTA)','561210',baseModel);
assert.strictEqual(maintenance.status,'CAPABILITY_VALIDATION_REQUIRED');
assert.strictEqual(maintenance.directFit,false);
assert(maintenance.score < 0);
assert.strictEqual(qualificationTier(maintenance,{}).code,'NOT_RECOMMENDED_DIRECT_PURSUIT');
assert.strictEqual(qualificationTier(maintenance,{}).recommendationEligible,false);

const it = capabilityAssessment('CWMS Database Authorization Maintenance and Improvements','541511',baseModel);
assert.strictEqual(it.status,'DEMONSTRATED_CAPABILITY_SUPPORTED');
assert.strictEqual(it.directFit,true);
assert.strictEqual(qualificationTier(it,{}).code,'DIRECT_FIT_SUPPORTED');
assert.strictEqual(qualificationTier(it,{}).recommendationEligible,true);

const logistics = capabilityAssessment('Warehousing and Distribution Services','493110',baseModel);
assert.strictEqual(logistics.status,'DEMONSTRATED_CAPABILITY_SUPPORTED');
assert.strictEqual(logistics.directFit,true);

const language = capabilityAssessment('American Sign Language Interpretation Services','561210',baseModel);
assert.strictEqual(language.status,'CAPABILITY_VALIDATION_REQUIRED');
assert.strictEqual(language.directFit,false);
assert.strictEqual(qualificationTier(language,{}).code,'NOT_RECOMMENDED_DIRECT_PURSUIT');

const sdvosb = compatibleSetAside('Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside',baseModel.profile);
assert.strictEqual(sdvosb.eligibilityBlocked,true);
assert(sdvosb.score < 0);
const teamingTier = qualificationTier(it,sdvosb);
assert.strictEqual(teamingTier.code,'TEAMING_PATH_SUPPORTED');
assert.strictEqual(teamingTier.directPursuit,false);
assert.strictEqual(teamingTier.teamingCandidate,true);
assert.strictEqual(teamingTier.recommendationEligible,true);

const small = compatibleSetAside('Total Small Business Set-Aside',baseModel.profile);
assert.strictEqual(small.eligibilityBlocked,undefined);
assert(small.score > 0);

const generic = capabilityAssessment('General program support services','541611',{ profile:{naicsCodes:['541611'],certifications:[],gsaContracts:[]},awardHistory:{primeAwards:[]} });
const validationTier = qualificationTier(generic,{});
assert.strictEqual(validationTier.code,'CAPABILITY_VALIDATION_REQUIRED');
assert.strictEqual(validationTier.recommendationEligible,false);

console.log('CURRENT_PUBLIC_OPPORTUNITY_CAPABILITY_GATE_TEST=GREEN');
