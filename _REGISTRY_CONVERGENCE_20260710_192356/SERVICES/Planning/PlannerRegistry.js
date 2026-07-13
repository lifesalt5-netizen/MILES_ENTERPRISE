const marketingPlanner = require("./MarketingPlanner");
const orionPlanner = require("./OrionPlanner");
const executivePlanner = require("./ExecutivePlanner");

class PlannerRegistry {
  constructor() {
    this.planners = [
      marketingPlanner,
      orionPlanner,
      executivePlanner
    ];
  }

  list() {
    return this.planners.map(planner => ({
      domain: planner.domain,
      workforce: planner.workforce
    }));
  }

  findPlanner(objective = "", context = {}) {
    return this.planners.find(planner => {
      try {
        return planner.matches(objective, context);
      } catch {
        return false;
      }
    }) || executivePlanner;
  }

  createOperationalPlan(objective = "", context = {}) {
    const planner = this.findPlanner(objective, context);
    return planner.createPlan(objective, context);
  }
}

module.exports = new PlannerRegistry();