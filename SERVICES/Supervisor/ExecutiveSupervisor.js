"use strict";

const discovery = require("../Discovery/DiscoveryEngine");

class ExecutiveSupervisor {

    async collectWork() {

        const discoveryResult = await discovery.discoverAll();

        const work = discoveryResult.work || [];

        work.sort((a,b)=>(b.priorityScore||0)-(a.priorityScore||0));

        return {
            ok:true,
            discovered:work.length,
            work
        };

    }

    async nextWorkItem(){

        const result = await this.collectWork();

        if(result.work.length===0){

            return null;

        }

        return result.work[0];

    }

}

module.exports = new ExecutiveSupervisor();