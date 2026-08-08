"use strict";

class DeployerAdapter {
  constructor() {
    this.name = "DEPLOYER";
  }

  execute(task = {}) {
    const authorization =
      task.authorization ||
      task.payload?.authorization ||
      task.payload?.deploymentAuthorization ||
      null;

    if (authorization !== "CEO_DEPLOYMENT_APPROVED") {
      const error = new Error("DEPLOYMENT_AUTHORIZATION_REQUIRED");
      error.code = "DEPLOYMENT_AUTHORIZATION_REQUIRED";
      throw error;
    }

    const error = new Error("DEPLOYMENT_EXECUTION_NOT_WIRED");
    error.code = "DEPLOYMENT_EXECUTION_NOT_WIRED";
    throw error;
  }
}

module.exports = DeployerAdapter;
