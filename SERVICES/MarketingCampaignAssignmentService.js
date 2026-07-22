"use strict";


const store =
require("../CORE/CANONICAL/EnterpriseStore");


class MarketingCampaignAssignmentService {


async run(){


const segments =
store.getSegments();


const campaigns =
store.getCampaigns();



let assigned = 0;



for(const segment of segments){


let campaign =
this.findCampaign(
segment,
campaigns
);



if(campaign){


store.upsertSegment({

...segment,

assignedCampaign:
campaign.name

});


assigned++;

}


}



return {

segmentsProcessed:
segments.length,

assigned

};


}





findCampaign(segment,campaigns){


const name =
segment.name.toUpperCase();



const rules = [

{
match:"SBS",
campaign:"SBS"
},

{
match:"GSA",
campaign:"GSA"
},

{
match:"VA",
campaign:"VA"
},

{
match:"EXPIRING",
campaign:"EXPIR"
},

{
match:"SETASIDE",
campaign:"HUBZONE"
},

{
match:"TRYING",
campaign:"WIN"
}

];



for(const rule of rules){


if(name.includes(rule.match)){


return campaigns.find(
c =>
c.name.toUpperCase()
.includes(rule.campaign)
);

}


}


return null;


}


}



module.exports =
MarketingCampaignAssignmentService;