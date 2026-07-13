"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
    process.env.MILES_ROOT ||
    "D:\\P2GC_Intelligence\\MILES_OS";

const FILE =
    path.join(ROOT,
        "DATA",
        "memory",
        "decision_history.json");

class DecisionHistory {

    constructor() {

        fs.mkdirSync(path.dirname(FILE), { recursive:true });

        if(!fs.existsSync(FILE)){

            fs.writeFileSync(FILE,
                JSON.stringify([],null,2));

        }

    }

    load(){

        return JSON.parse(fs.readFileSync(FILE));

    }

    save(history){

        fs.writeFileSync(
            FILE,
            JSON.stringify(history,null,2));

    }

    record(decision){

        const history=this.load();

        history.push(decision);

        this.save(history);

        return history.length;

    }

}

module.exports=new DecisionHistory();