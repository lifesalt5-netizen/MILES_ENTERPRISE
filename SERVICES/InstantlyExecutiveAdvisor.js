"use strict";

require("dotenv").config();

process.env.MILES_ROOT =
    process.env.MILES_ROOT || process.cwd();

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT;

const INVENTORY =
    path.join(
        ROOT,
        "DATA",
        "instantly",
        "campaign_inventory.json"
    );

const OUT_DIR =
    path.join(
        ROOT,
        "DATA",
        "instantly"
    );

const REPORT =
    path.join(
        OUT_DIR,
        "executive_advisor.json"
    );

const WORK_QUEUE =
    path.join(
        ROOT,
        "DATA",
        "runtime",
        "work_queue.json"
    );

function readJson(file, fallback) {

    try {

        if (!fs.existsSync(file))
            return fallback;

        return JSON.parse(
            fs.readFileSync(file, "utf8")
        );

    }
    catch {

        return fallback;

    }

}

function writeJson(file, value) {

    fs.mkdirSync(
        path.dirname(file),
        { recursive:true }
    );

    fs.writeFileSync(
        file,
        JSON.stringify(value,null,2),
        "utf8"
    );

}

class InstantlyExecutiveAdvisor {

    run() {

        const inventory =
            readJson(INVENTORY,{
                inventory:[]
            });

        const queueFile =
            readJson(
                WORK_QUEUE,
                {
                    items: [],
                    metadata: {}
                }
         );

if (!Array.isArray(queueFile.items)) {
    queueFile.items = [];
}

        const recommendations=[];

        let healthy=0;
        let review=0;

        for(const campaign of inventory.inventory){

            if(campaign.health==="GOOD"){

                healthy++;

                recommendations.push({

                    campaign:campaign.name,

                    priority:"NONE",

                    summary:"Healthy",

                    action:"NO_ACTION"

                });

                continue;

            }

            review++;

            const actions=[];

            if(
                campaign.issues.includes(
                    "NO_SENDING_ACCOUNTS"
                )
            ){

                actions.push(
                    "Assign sending accounts"
                );

            }

            if(
                campaign.issues.includes(
                    "NO_SEQUENCE_STEPS"
                )
            ){

                actions.push(
                    "Create email sequence"
                );

            }

            if(
                campaign.dailyLimit===0
            ){

                actions.push(
                    "Increase daily limit"
                );

            }

            const work={

                id:
                    `WORK_${Date.now()}_${Math.random()
                        .toString(36)
                        .substring(2,8)}`,

                worker:
                    "InstantlyCOOWorker",

                type:
                    "CONFIGURE_CAMPAIGN",

                campaign:
                    campaign.name,

                campaignId:
                    campaign.campaignId,

                priority:1,

                reason:
                    campaign.issues.join(", "),

                status:
                    "QUEUED",

                created:
                    new Date().toISOString()

            };

            queueFile.items.push(work);

            recommendations.push({

                campaign:
                    campaign.name,

                priority:
                    "HIGH",

                summary:
                    "Needs Configuration",

                issues:
                    campaign.issues,

                actions

            });

        }

        writeJson(
            WORK_QUEUE,
            queueFile
        );

        const report={

            ok:true,

            generatedAt:
                new Date().toISOString(),

            totals:{

                campaigns:
                    inventory.campaignCount,

                healthy,

                review,

                queuedWork:
                    queueFile.items.length

            },

            recommendations

        };

        writeJson(
            REPORT,
            report
        );

        return report;

    }

}

module.exports =
    new InstantlyExecutiveAdvisor();