"use strict";


class WorkerRegistry {


    constructor(){

        this.workers = {};

    }


    register(type, worker){

        this.workers[type] = worker;

        return {
            type,
            status:"REGISTERED"
        };

    }


    get(type){

        return this.workers[type] || null;

    }


    list(){

        return Object.keys(this.workers);

    }


}


module.exports = new WorkerRegistry();