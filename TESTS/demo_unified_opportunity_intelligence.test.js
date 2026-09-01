'use strict';

const assert = require('assert');
const Unified = require('../SERVICES/demo/DemoUnifiedOpportunityService');

const service = new Unified();
const model = {
  opportunities:{
    liveAndForecast:[
      { id:'FED-1', market:'FEDERAL', title:'Cybersecurity RFI', agency:'Department of Example', type:'Request for Information', dueDate:'2026-10-01', source:'SAM.gov' },
      { id:'ST-1', market:'SLED', title:'State network services RFP', agency:'State of Example', type:'Solicitation', dueDate:'2026-10-10', source:'State procurement portal' },
      { id:'LOC-1', market:'LOCAL', title:'County IT support bid', agency:'Example County', type:'Open Bid', dueDate:'2026-10-20', source:'County procurement portal' },
      { id:'FC-1', market:'FEDERAL', title:'FY27 acquisition forecast - cloud support', agency:'Department of Example', type:'Forecast', source:'Agency acquisition forecast' },
      { id:'SS-1', market:'FEDERAL', title:'Sources Sought - engineering support', agency:'Department of Example', type:'Sources Sought', source:'SAM.gov' }
    ],
    recompetes:[{ id:'REC-1', market:'FEDERAL', title:'Enterprise support recompete', agency:'Department of Example' }],
    similarRecentAwards:[{ id:'GSA-MISS-1', market:'FEDERAL', title:'Recent comparable GSA award won by peer', agency:'GSA buyer', source:'USAspending.gov' }]
  }
};

const result = service.build(model);
assert.strictEqual(result.totals.federal, 5);
assert.strictEqual(result.totals.sled, 1);
assert.strictEqual(result.totals.local, 1);
assert.strictEqual(result.markets.FEDERAL.byStage.RFI.length, 1);
assert.strictEqual(result.markets.FEDERAL.byStage.SOURCES_SOUGHT.length, 1);
assert.strictEqual(result.markets.FEDERAL.byStage.FORECAST.length, 1);
assert.strictEqual(result.markets.FEDERAL.byStage.RECOMPETE.length, 1);
assert.strictEqual(result.markets.FEDERAL.byStage.RECENT_SIMILAR_AWARD.length, 1);
assert.strictEqual(result.markets.SLED.byStage.OPEN.length, 1);
assert.strictEqual(result.markets.LOCAL.byStage.OPEN.length, 1);
assert.strictEqual(result.rules.loginGatedSourcesNeverPretendedLive, true);
assert(/GSA/.test(result.rules.gsaFallback));
console.log('DEMO_UNIFIED_OPPORTUNITY_INTELLIGENCE_TEST_PASS');
