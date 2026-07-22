"use strict";

const store =
require("../CORE/CANONICAL/EnterpriseStore");


class MarketingRecommendationStoreService {


async run(){


const planner =
require("./MarketingOpportunityPlannerService");


const p =
new planner();


const result =
await p.run();


let saved = 0;


for(const rec of result.recommendations){


store.createMarketingRecommendation({

id:
rec.id,

segmentId:
rec.segmentId,

segmentName:
rec.segmentName,

campaignId:
rec.campaignId,

campaignName:
rec.campaignName,

priority:
rec.priority,

recommendedUpload:
rec.recommendedUpload,

reason:
rec.reason,

status:
rec.status

});


saved++;


}


return {

processed:
result.recommendations.length,

saved

};


}



}


module.exports =
MarketingRecommendationStoreService;