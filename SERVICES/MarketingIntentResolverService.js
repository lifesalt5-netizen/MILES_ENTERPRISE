const store=require("../CORE/CANONICAL/EnterpriseStore");

class MarketingIntentResolverService {


async run(){

const recs =
store.getMarketingRecommendations();


let updated=0;


for(const rec of recs){


const result =
this.classify(rec.segmentName);


store.createMarketingRecommendation({

id:rec.id,

segmentId:rec.segmentId,

segmentName:rec.segmentName,

campaignId:rec.campaignId,

campaignName:rec.campaignName,

priority:
result.priority,

recommendedUpload:
result.executionAllowed
?
rec.recommendedUpload
:
0,

reason:
result.reason,

status:
result.status

});


updated++;

}


return {
processed:recs.length,
updated
};


}



classify(name){

const n=name.toUpperCase();



if(
n.includes("MASTER") ||
n.includes("CANONICAL")
){

return {
status:"DATA_ASSET",
executionAllowed:false,
priority:0,
reason:"Internal intelligence dataset. No outbound execution."
};

}



if(
n.includes("SUMMARY") ||
n.includes("MISSING_SEGMENTS")
){

return {
status:"OPERATIONS_ONLY",
executionAllowed:false,
priority:0,
reason:"Operational dataset. Requires internal processing only."
};

}



if(
n.includes("TRYING_NOT_WINNING")
){

return {
status:"REVENUE_TARGET",
executionAllowed:true,
priority:100,
reason:"Competitive displacement opportunity."
};

}



if(
n.includes("NOT_BUILDABLE")
){

return {
status:"NEEDS_BUILD",
executionAllowed:false,
priority:10,
reason:"Requires additional data acquisition."
};

}



return {
status:"REVIEW",
executionAllowed:false,
priority:50,
reason:"Requires review."
};


}


}


module.exports=MarketingIntentResolverService;