'use strict';
const assert=require('assert');
const Service=require('../SERVICES/orion/SamBulkExtractAcquisitionService');
const {candidateEntityNames}=Service;
const names=candidateEntityNames(new Date('2026-08-30T12:00:00Z'),4);
assert(names[0]==='SAM_PUBLIC_UTF-8_MONTHLY_V2_20260802.ZIP', names[0]);
assert(names.includes('SAM_PUBLIC_UTF-8_MONTHLY_V2_20260705.ZIP'));
assert(names.every(x=>/^SAM_PUBLIC_UTF-8_MONTHLY_V2_\d{8}\.ZIP$/.test(x)));
console.log('SAM_BULK_ACQUISITION_FALLBACK_TEST=PASS');
