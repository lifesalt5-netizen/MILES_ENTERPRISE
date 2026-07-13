"use strict";
const resolutionMemory =
    require("./ResolutionMemoryService");
const WebsiteProvider =
    require("../PROVIDERS/providers/WebsiteProvider");
    


class ResolutionEngine {

    async verifyWebsite() {

        const provider =
            new WebsiteProvider();

        await provider.initialize();

        const state =
            provider.getProviderState();

        const result = {

    component:
        "WebsiteProvider",

    resolved:
        state.status === "Healthy",

    state

};


if(result.resolved) {

    resolutionMemory.record({

        component:
            "WebsiteProvider",

        failure:
            "WebsiteProviderLoadFailure",

        resolved:
            true,

        resolution:
            "Website health verification passed"

    });

}


return result;

    }


    async evaluate(issue) {

        if (!issue) {

            return {
                resolved:false,
                reason:"No issue supplied"
            };

        }


        if (
            issue.type === "WebsiteProviderLoadFailure" ||
            String(issue.title || "")
                .includes("WebsiteProvider")
        ) {

            return await this.verifyWebsite();

        }


        return {

            resolved:false,

            reason:
                "No resolver available"

        };

    }

}


module.exports =
    new ResolutionEngine();