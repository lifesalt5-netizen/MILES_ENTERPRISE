"use strict";

const resolver =
require("../SERVICES/ResolutionEngine");


(async()=>{

    const result =
        await resolver.evaluate({

            type:
            "WebsiteProviderLoadFailure",

            title:
            "Critical exception: WebsiteProviderLoadFailure"

        });


    console.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );

})();