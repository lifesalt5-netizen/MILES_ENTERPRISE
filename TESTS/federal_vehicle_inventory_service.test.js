'use strict';
const assert=require('assert');
const {helpers}=require('../SERVICES/demo/FederalVehicleInventoryService');

const kebrosHtml=`
<html><body>
Contractor: KEBROS & ASSOC LLC Address: 123 TEST ST SAM UEI: PFDWQAX9BHX6
<table>
<tr><th>Source</th><th>Title</th><th>Contract Number</th><th>Current Option Period End Date</th><th>Ultimate Contract End Date</th><th>Category</th></tr>
<tr><td>621 I</td><td>PROFESSIONAL AND ALLIED HEALTHCARE STAFFING SERVICES</td><td>36F79726D0023</td><td>Mar 14, 2031</td><td>Mar 14, 2046</td><td>621-025</td></tr>
</table>
</body></html>`;
const kebros=helpers.parseContractorInfo(kebrosHtml);
assert.strictEqual(kebros.uei,'PFDWQAX9BHX6');
assert.strictEqual(kebros.records.length,1);
assert.strictEqual(kebros.records[0].contractNumber,'36F79726D0023');
assert.strictEqual(kebros.records[0].vehicleType,'VA_FSS_621I');

const multiHtml=`
<table>
<tr><td>MAS</td><td>Multiple Award Schedule</td><td>GS-00F-176GA</td><td>Apr 23, 2027</td><td>Apr 23, 2037</td><td>541611</td></tr>
<tr><td>OASIS+SB</td><td>OASIS+ SB</td><td>47QRCA25DS465</td><td>Dec 18, 2029</td><td></td><td>10201</td></tr>
<tr><td>8ASTARS3</td><td>8(a) Streamlined Technology Acquisition Resource for Services (STARS) III</td><td>47QTCB22D0066</td><td>Jul 1, 2026</td><td></td><td>STARS3</td></tr>
</table>`;
const multi=helpers.parseContractorInfo(multiHtml);
assert.strictEqual(multi.records.length,3);
assert(multi.records.some(x=>x.vehicleType==='GSA_MAS'));
assert(multi.records.some(x=>x.vehicleType==='OASIS_PLUS'));
assert(multi.records.some(x=>x.vehicleType==='STARS_III'));

const model={profile:{gsaContracts:[]},awardHistory:{primeAwards:[{awardId:'36F79726D0023',awardType:'IDV'}]}};
assert(helpers.seedContractNumbers(model).includes('36F79726D0023'));

console.log('FEDERAL_VEHICLE_INVENTORY_SERVICE_TEST=GREEN');
