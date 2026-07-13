class EngineeringPlanner {

    constructor() {

        this.backlog = [];

        this.currentSprint = [];

        this.readyQueue = [];

        this.blocked = [];

    }

    addWork(workItem){

        workItem.status = "Backlog";

        this.backlog.push(workItem);

    }

    prioritize(){

        this.backlog.sort((a,b)=>{

            return (b.priority || 0) - (a.priority || 0);

        });

    }

    buildSprint(maxItems = 10){

        this.prioritize();

        this.currentSprint = this.backlog.splice(0,maxItems);

        this.currentSprint.forEach(x=>{

            x.status="Sprint";

        });

        return this.currentSprint;

    }

    queueReady(){

        this.readyQueue = this.currentSprint.filter(x=>{

            return !x.blocked;

        });

        return this.readyQueue;

    }

    getStatus(){

        return {

            backlog:this.backlog.length,

            sprint:this.currentSprint.length,

            ready:this.readyQueue.length,

            blocked:this.blocked.length

        };

    }

}

module.exports = EngineeringPlanner;