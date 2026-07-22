"use strict";

const store = require("../CORE/CANONICAL/EnterpriseStore");
const Instantly = require("./InstantlyLiveProviderController");


class CampaignSyncService {


async run(){

    const response =
        await Instantly.execute({
            operation:"LIST_CAMPAIGNS",
            payload:{
                query:"?limit=100"
            }
        });


    if(!response.ok){

        throw new Error(
            "Instantly campaign sync failed"
        );

    }


    const campaigns =
        response.result.data.items || [];


    let synced=0;


    for(const campaign of campaigns){


        store.upsertCampaign({

            id:campaign.id,

            name:campaign.name,

            status:
                campaign.status === 1
                ? "ACTIVE"
                : "PAUSED",

            dailyLimit:
                campaign.daily_limit || 0,

            payload:campaign

        });


        synced++;

    }


    return {

        synced,

        total:campaigns.length

    };


}


}


module.exports =
CampaignSyncService;