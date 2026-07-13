"use strict";

const EnterpriseScheduler = require("./EnterpriseScheduler");
const EnterpriseJobRegistry = require("./EnterpriseJobRegistry");
const registerMarketingWorkflow = require("./MarketingWorkflow");

class EnterpriseSchedulerLoader {
  constructor() {
    this.scheduler = new EnterpriseScheduler();
    this.registry = new EnterpriseJobRegistry();
    this.availableHandlers = new Map();
    this.loadHandlers();
  }

  loadHandlers() {
    registerMarketingWorkflow(this.scheduler);

    for (const jobName of this.scheduler.jobs.keys()) {
      this.availableHandlers.set(jobName, this.scheduler.jobs.get(jobName));
    }

    this.scheduler.jobs.clear();
  }

  loadEnabledJobs() {
    const jobs = this.registry
      .list("ENABLED")
      .sort((a, b) => Number(a.priority || 50) - Number(b.priority || 50));

    for (const job of jobs) {
      const handler = this.availableHandlers.get(job.jobName);

      if (!handler) {
        this.scheduler.store.insertEvent("SCHEDULER_HANDLER_MISSING", "Scheduler", {
          jobName: job.jobName,
          department: job.department
        });
        continue;
      }

      this.scheduler.register(job.jobName, handler);
    }

    return jobs.map(job => ({
      jobName: job.jobName,
      department: job.department,
      priority: job.priority,
      status: job.status,
      handlerFound: this.availableHandlers.has(job.jobName)
    }));
  }

  async runEnabledJobs() {
    const loaded = this.loadEnabledJobs();
    const results = await this.scheduler.runAll();

    return {
      loaded,
      results
    };
  }
}

module.exports = EnterpriseSchedulerLoader;
