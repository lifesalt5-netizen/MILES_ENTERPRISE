"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const store = require("../CORE/CANONICAL/EnterpriseStore");


class SegmentSyncService {


constructor(){

    this.folder =
    "D:\\P2GC_Intelligence\\ARCHIVE_2026_REVIEW\\Good Files to use\\Good To Use and segmented";

}



async run(){

    const files =
        fs.readdirSync(this.folder)
        .filter(x =>
            x.toLowerCase().endsWith(".csv")
        );


    let synced = 0;


    for(const file of files){

        const fullPath =
            path.join(
                this.folder,
                file
            );


        const meta =
            await this.inspectCsv(fullPath);


        store.upsertSegment({

            id:
                file
                .replace(".csv","")
                .toUpperCase(),

            name:
                file
                .replace(".csv",""),

            category:"SEGMENT",

            file:fullPath,

            exactRows:
                meta.rows,

            verified:
                meta.hasEmail,

            readyForUpload:
                meta.hasEmail,

            uploadStatus:
                meta.hasEmail
                ? "READY"
                : "REVIEW",

            nextAction:
                meta.hasEmail
                ? "Assign campaign and upload"
                : "Needs email enrichment"

        });


        synced++;

    }


    return {

        synced,

        total:files.length

    };


}




async inspectCsv(file){

    return new Promise((resolve,reject)=>{


        let rows=0;
        let headers=null;


        const stream =
            fs.createReadStream(file);


        const rl =
            readline.createInterface({
                input:stream,
                crlfDelay:Infinity
            });



        rl.on("line",(line)=>{


            if(!headers){

                headers =
                    line.split(",");

                return;

            }


            rows++;


        });



        rl.on("close",()=>{


            const emailFound =
                headers.some(h =>
                    h.toLowerCase()
                    .includes("email")
                );


            resolve({

                rows,

                hasEmail:
                    emailFound

            });


        });


        rl.on("error",reject);


    });


}



}



module.exports = SegmentSyncService;