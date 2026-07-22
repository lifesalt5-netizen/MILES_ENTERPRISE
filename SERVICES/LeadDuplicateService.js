"use strict";

const store = require("../CORE/CANONICAL/EnterpriseStore");


class LeadDuplicateService {


    isAlreadyUploaded(email,campaignId){

        if(!email){
            return false;
        }


        const existing =
            store.findLeadUpload(
                email,
                campaignId
            );


        return Boolean(existing);

    }



    filterNewLeads(leads,campaignId){

        const newLeads = [];
        const skipped = [];


        for(const lead of leads){

            if(
                this.isAlreadyUploaded(
                    lead.email,
                    campaignId
                )
            ){

                skipped.push(lead);

            }
            else{

                newLeads.push(lead);

            }

        }


        return {

            newLeads,

            skipped

        };

    }


}


module.exports = LeadDuplicateService;