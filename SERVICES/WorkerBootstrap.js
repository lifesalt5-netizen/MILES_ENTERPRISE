"use strict";

const registry = require("./WorkerRegistry");

const atlasAdapter =
require("./WORKER_ADAPTERS/AtlasWorkerAdapter");

const architectAdapter =
require("./WORKER_ADAPTERS/ArchitectAdapter");

const builderAdapter =
require("./WORKER_ADAPTERS/BuilderAdapter");

const validatorAdapter =
require("./WORKER_ADAPTERS/ValidatorAdapter");

const testerAdapter =
new (
require("./WORKER_ADAPTERS/TesterAdapter")
)();

const deployerAdapter =
require("./WORKER_ADAPTERS/DeployerAdapter");

const recoveryAdapter =
new (
require("./WORKER_ADAPTERS/RecoveryAdapter")
)();

const selfDevelopmentAdapter =
require("./WORKER_ADAPTERS/SelfDevelopmentAdapter");

function bootstrapWorkers() {

    registry.register(
        "SELF_DEVELOPMENT",
        selfDevelopmentAdapter
    );

    registry.register(
        "ATLAS",
        atlasAdapter
    );

    registry.register(
        "ARCHITECT",
        architectAdapter
    );

    registry.register(
        "BUILDER",
        builderAdapter
    );

    registry.register(
        "VALIDATOR",
        validatorAdapter
    );

    registry.register(
        "TESTER",
        testerAdapter
    );

    registry.register(
        "DEPLOYER",
        deployerAdapter
    );

    registry.register(
        "RECOVERY",
        recoveryAdapter
    );


    console.log(
        "[WORKERS] Registered:",
        registry.list()
    );

}


module.exports = bootstrapWorkers;
