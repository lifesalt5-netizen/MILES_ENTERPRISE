const store=require("../CORE/CANONICAL/EnterpriseStore");

class MarketingCampaignGapResolverService {


async run(){

const recommendations =
store.getMarketingRecommendations()
.filter(x=>!x.campaignId);


let resolved=0;


for(const rec of recommendations){


let campaign =
this.findCampaign(rec.segmentName);


if(!campaign){
continue;
}


store.createMarketingRecommendation({

id:rec.id,

segmentId:rec.segmentId,

segmentName:rec.segmentName,

campaignId:campaign.id,

campaignName:campaign.name,

priority:rec.priority,

recommendedUpload:rec.recommendedUpload,

reason:
`${rec.reason} Assigned by campaign gap resolver.`,

status:"RECOMMENDED"

});


resolved++;

}


return {

checked:recommendations.length,

resolved

};


}



findCampaign(segmentName){


const campaigns =
store.getCampaigns();


const s =
segmentName.toUpperCase();



const match =
campaigns.find(c=>{

const name =
c.name.toUpperCase();


return (

s.includes("GSA") &&
name.includes("GSA")

)

||
(
s.includes("VA") &&
name.includes("VA")
)

||
(
s.includes("SAM") &&
name.includes("SAM")
)

||
(
s.includes("SBS") &&
name.includes("SBS")
)

||
(
s.includes("8A") &&
name.includes("8")
)

});


return match || null;


}



}


module.exports=MarketingCampaignGapResolverService;