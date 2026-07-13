"use strict";

const CapabilityRegistry = require("./CapabilityRegistry");

class MissionCapabilityResolver {

    constructor() {

        this.map = {

            close_mission: "close_mission",

            validate_resolution: "validate_resolution",

            website_health: "website_health",

            website_update: "website_update",

            execute_worker: "execute_worker",

            create_mission: "create_mission",

            collect_learning_data: "collect_learning_data"

        };

    }

    resolve(mission) {

        const capability =

            mission.requiredCapability ||

            this.map[mission.type] ||

            null;

        if (!capability) {

            return {

                ok: false,

                reason: "No capability mapping."

            };

        }

        const matches =

            CapabilityRegistry.findByCapability(capability);

        return {

            ok: matches.length > 0,

            capability,

            workers: matches

        };

    }

}

module.exports = new MissionCapabilityResolver();