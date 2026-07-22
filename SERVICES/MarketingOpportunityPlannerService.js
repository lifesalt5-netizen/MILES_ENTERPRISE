"use strict";


const store = require("../CORE/CANONICAL/EnterpriseStore");


class MarketingOpportunityPlannerService {


    async run(){

        const segments =
            store.getSegments();


        const campaigns =
            store.getCampaigns();


        const history =
            store.getLeadUploadHistory();



        const recommendations = [];



        for(const segment of segments){


            const campaign =
                campaigns.find(
                    c =>
                    c.name === segment.assignedCampaign
                    ||
                    c.name.includes(segment.name)
                );



            const uploadedCount =
                history.filter(
                    h =>
                    h.segmentId === segment.id
                ).length;



            const availableRows =
                Number(
                    segment.exactRows || 0
                );



            if(
                availableRows <= 0
            ){
                continue;
            }



            const priority =
                this.calculatePriority(
                    segment,
                    uploadedCount
                );



            recommendations.push({

                id:
                store.id("MARKETING_REC"),


                segmentId:
                segment.id,


                segmentName:
                segment.name,


                campaignId:
                campaign?.id || null,


                campaignName:
                campaign?.name || null,


                availableRows,


                alreadyUploaded:
                uploadedCount,


                recommendedUpload:

                Math.min(
                    250,
                    availableRows
                ),


                priority,


                reason:
                this.reason(
                    segment,
                    uploadedCount
                ),


                status:"RECOMMENDED"


            });


        }



        return {

            analyzedSegments:
            segments.length,


            recommendations:
            recommendations.sort(
                (a,b)=>
                b.priority-a.priority
            )


        };

    }





    calculatePriority(segment,uploaded){


        let score = 0;


        if(segment.verified){
            score += 30;
        }


        if(segment.readyForUpload){
            score += 30;
        }


        if(
            Number(segment.exactRows)>1000
        ){
            score +=20;
        }


        if(uploaded===0){
            score +=20;
        }


        return score;

    }





    reason(segment,uploaded){


        if(uploaded===0){

            return "Verified segment available with no prior uploads.";

        }


        return "Existing segment with historical activity.";

    }


}



module.exports =
MarketingOpportunityPlannerService;