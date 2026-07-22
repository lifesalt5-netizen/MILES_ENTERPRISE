"use strict";

const fs = require("fs");
const csv = require("csv-parser");

const store = require("../CORE/CANONICAL/EnterpriseStore");
const logger = require("../CORE/CANONICAL/Logger");

const Instantly = require("./InstantlyLiveProviderController");

const LeadDuplicateService = require("./LeadDuplicateService");

class MarketingUploadExecutorService {

  constructor(){

    this.instantly = Instantly;
this.duplicateService = new LeadDuplicateService();

  }


  async initialize(){

    return true;

  }



  async run(){

    await this.initialize();


    const queue =
      store.getUploadQueue()
      .filter(x =>
        x.status === "APPROVED"
      );


    const results=[];


    for(const item of queue){

      try{

        const result =
          await this.executeUpload(item);


        results.push(result);


      }
      catch(err){

        logger.error(
          "MARKETING_UPLOAD_FAILED",
          {
            id:item.id,
            error:err.message
          }
        );


        results.push({
          id:item.id,
          status:"FAILED",
          error:err.message
        });

      }

    }


    return {
      processed:results.length,
      results
    };

  }




  async executeUpload(item){


    const payload =
      item.payload.segmentPayload;


    const leads =
      await this.readCsv(
        payload.file,
        item.approvedUploadCount ||
        item.requestedUploadCount ||
        85
      );


    if(!leads.length){

      throw new Error(
        "No leads extracted from CSV"
      );

    }

const validLeads =
  leads.filter(x =>
    x.email &&
    x.email.includes("@") &&
    x.company_name &&
    x.company_name.length > 2
  );


if(validLeads.length !== leads.length){

  console.log(
    "REMOVED INVALID LEADS",
    {
      before:leads.length,
      after:validLeads.length
    }
  );

}


if(!validLeads.length){

  throw new Error(
    "No valid leads after validation"
  );

}

    const duplicateCheck =
      this.duplicateService.filterNewLeads(
        leads,
        item.campaignId
      );


const uploadLeads =
      duplicateCheck.newLeads;


if(!uploadLeads.length){

    store.updateUploadQueue(
      item.id,
      {
        status:"COMPLETED",
        approvedUploadCount:0
      }
    );


    return {

      id:item.id,

      segment:item.segmentName,

      campaign:item.campaignName,

      uploaded:0,

      skipped:
        duplicateCheck.skipped.length,

      status:"COMPLETED_DUPLICATES_ONLY"

    };

}



const response =
      await this.instantly.execute(
        {
          operation:"UPLOAD_LEADS",
          payload:{
            campaignId:item.campaignId,
            leads:uploadLeads
          }
        }
      );



    /*
      Production success rule:

      A marketing upload is only successful when
      the external provider confirms execution.

      Safe mode:
      {
        ok:true,
        executed:false,
        status:"SAFE_MODE_WRITE_DISABLED"
      }

      is NOT success.
    */

    const executionSucceeded =
      Boolean(
        response &&
        response.executed === true &&
        response.status !== "SAFE_MODE_WRITE_DISABLED"
      );

    console.log("UPLOAD DEBUG", JSON.stringify({
      response,
      executionSucceeded,
      queueId:item.id
    },null,2));

    const finalStatus =
      executionSucceeded
        ? "COMPLETED"
        : "WAITING_PROVIDER";



    store.updateUploadQueue(
      item.id,
      {
        status:finalStatus,
        approvedUploadCount:
          executionSucceeded
            ? validLeads.length
            : 0
      }
    );



    store.createUploadQueueRun({

      queueId:item.id,

      status:finalStatus,

      uploaded:
        executionSucceeded
          ? leads.length
          : 0,

      response

    });



    return {

      id:item.id,

      segment:item.segmentName,

      campaign:item.campaignName,

      uploaded:
        executionSucceeded
          ? leads.length
          : 0,

      status:finalStatus,

      providerStatus:
        response?.status || null

    };


  }






    async readCsv(file,count){

    const leads=[];

    return new Promise((resolve,reject)=>{

      fs.createReadStream(file)
        .pipe(csv())
        .on("data",(row)=>{

          if(leads.length >= count){
            return;
          }


          const email =
            row.email ||
            row.Email ||
            row["Contact person's email"] ||
            row.POC_Email ||
            "";


          const cleanEmail =
            String(email)
            .trim()
            .toLowerCase();


          /*
            Reject bad email mappings.
            Prevent:
            Brian Smith
            SDVOSB
            VOSB
            company names
            from entering Instantly.
          */

          if(
            !cleanEmail.includes("@") ||
            !cleanEmail.includes(".")
          ){
            return;
          }



          const company =
            row.company ||
            row["Business name"] ||
            row.company_name ||
            row.Legal_Name ||
            "";



          const name =
            row.first_name ||
            row.First ||
            row["Contact person's name"] ||
            "";



          leads.push({

            email: cleanEmail,

            first_name:
              String(name).trim(),

            company_name:
              String(company).trim()

          });


        })
        .on("end",()=>{

          resolve(leads);

        })
        .on("error",reject);

    });

  }


}



module.exports =
MarketingUploadExecutorService;
