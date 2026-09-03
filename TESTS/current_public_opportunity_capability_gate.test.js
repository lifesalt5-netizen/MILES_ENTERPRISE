'use strict';
const assert = require('assert');
const { capabilityAssessment, compatibleSetAside } = require('../SERVICES/demo/CurrentPublicOpportunityMatchService');

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

const it = capabilityAssessment('CWMS Database Authorization Maintenance and Improvements','541511',baseModel);
assert.strictEqual(it.status,'DEMONSTRATED_CAPABILITY_SUPPORTED');
assert.strictEqual(it.directFit,true);

const logistics = capabilityAssessment('Warehousing and Distribution Services','493110',baseModel);
assert.strictEqual(logistics.status,'DEMONSTRATED_CAPABILITY_SUPPORTED');
assert.strictEqual(logistics.directFit,true);

const language = capabilityAssessment('American Sign Language Interpretation Services','561210',baseModel);
assert.strictEqual(language.status,'CAPABILITY_VALIDATION_REQUIRED');
assert.strictEqual(language.directFit,false);

const sdvosb = compatibleSetAside('Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside',baseModel.profile);
assert.strictEqual(sdvosb.eligibilityBlocked,true);
assert(sdvosb.score < 0);

const small = compatibleSetAside('Total Small Business Set-Aside',baseModel.profile);
assert.strictEqual(small.eligibilityBlocked,undefined);
assert(small.score > 0);

console.log('CURRENT_PUBLIC_OPPORTUNITY_CAPABILITY_GATE_TEST=GREEN');
