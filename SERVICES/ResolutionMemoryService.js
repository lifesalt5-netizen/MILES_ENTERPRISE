"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
    process.env.MILES_ROOT || process.cwd();

const FILE =
    path.join(
        ROOT,
        "DATA",
        "self_learning",
        "resolution_history.json"
    );


class ResolutionMemoryService {

    record(event) {

        let history = [];

        if(fs.existsSync(FILE)) {

            history =
                JSON.parse(
                    fs.readFileSync(
                        FILE,
                        "utf8"
                    )
                );

        }


        history.push({

            timestamp:
                new Date().toISOString(),

            component:
                event.component,

            failure:
                event.failure,

            resolved:
                event.resolved,

            resolution:
                event.resolution ||

                "Health verification completed"

        });


        fs.mkdirSync(
            path.dirname(FILE),
            {
                recursive:true
            }
        );


        fs.writeFileSync(
            FILE,
            JSON.stringify(
                history.slice(-500),
                null,
                2
            )
        );


        return {

            recorded:true,

            total:
                history.length

        };

    }

}


module.exports =
    new ResolutionMemoryService();