"use strict";
const assert = require("assert");
const DemoCommercialPreviewService = require("../SERVICES/demo/DemoCommercialPreviewService");

const service = new DemoCommercialPreviewService({ opportunities:2, recompetes:2, primePartners:2, buyers:2, competitors:3, vehicles:2 });
const model = {
  ok:true,
  revenue:{current:{federal:100000}},
  competitors:{records:[
    {company:"Prime A",federalRevenue:1000000,agencies:["VA"],confidence:"MODELED_CANDIDATE"},
    {company:"Prime B",federalRevenue:900000,agencies:["DOD"],confidence:"MODELED_CANDIDATE"},
    {company:"Prime C",federalRevenue:800000,agencies:["HHS"],confidence:"MODELED_CANDIDATE"},
    {company:"Peer D",federalRevenue:700000,agencies:["VA"]}
  ]},
  primePartners:{records:[],strategy:[]},
  buyerIntelligence:{records:[{agency:"VA"},{agency:"DOD"},{agency:"HHS"}]},
  opportunities:{liveAndForecast:[{title:"Opp 1"},{title:"Opp 2"},{title:"Opp 3"},{title:"Opp 4"}],recompetes:[{title:"R1"},{title:"R2"},{title:"R3"}]},
  vehicles:{current:["GSA MAS","SEWP","CIO-SP4"]}
};
const out = service.apply(model);
assert.strictEqual(out.primePartners.records.length,4);
assert.strictEqual(out.primePartners.records[0].partnerStatus,"MODELED_PRIME_TEAMING_CANDIDATE");
assert.strictEqual(out.commercialPreview.opportunities.visibleCount,2);
assert.strictEqual(out.commercialPreview.opportunities.lockedCount,2);
assert.strictEqual(out.commercialPreview.primePartners.visibleCount,2);
assert.strictEqual(out.commercialPreview.primePartners.lockedCount,2);
assert.strictEqual(out.commercialPreview.buyers.lockedCount,1);
assert.strictEqual(out.commercialPreview.competitors.lockedCount,1);
assert.strictEqual(out.commercialPreview.vehicles.lockedCount,1);

const noFake = service.apply({ok:true,competitors:{records:[]},primePartners:{records:[]},buyerIntelligence:{records:[]},opportunities:{liveAndForecast:[{title:"Only"}],recompetes:[]},vehicles:{current:[]},revenue:{current:{federal:null}}});
assert.strictEqual(noFake.commercialPreview.opportunities.lockedCount,0);
assert.strictEqual(noFake.commercialPreview.primePartners.lockedCount,0);
console.log("DEMO_COMMERCIAL_PREVIEW_TEST_PASS");
