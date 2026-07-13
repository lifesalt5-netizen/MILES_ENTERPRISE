"use strict";

/*
===============================================================================
MILES Enterprise
CONNECTORS/MILES/connector.js

Purpose
-------
Primary internal connector for all MILES-native capabilities.

Execution Flow

ExecutionService
    ↓
ConnectorManager
    ↓
MILES Connector (this file)
    ↓
Internal Capability Service

This connector contains NO business logic.
It ONLY routes actions to the proper internal capability.

===============================================================================
*/

const builder = require("../../SERVICES/capability_builder/AutonomousCapabilityBuilderService");
const repositorySearch = require("../../SERVICES/RepositorySearchService");

/*
===============================================================================
Capability Routing Table

As new MILES capabilities are added,
ONLY update this routing table.

Do NOT create another execution engine.
Do NOT create another connector.
===============================================================================
*/

const ACTION_HANDLERS = {

    REPOSITORY_SEARCH: repositorySearch,

    CODE_WRITER_CAPABILITY_AUDIT: repositorySearch,

    REPOSITORY_EVIDENCE_REPORT: repositorySearch

};

module.exports = {

    name: "MILES",

    async initialize() {

        return {
            ok: true,
            service: "MILES Internal Capability Connector"
        };

    },

    async healthCheck() {

        return {
            ok: true,
            status: "OK",
            service: "MILES Internal Capability Connector",
            message: "Internal capability routing operational.",
            checkedAt: new Date().toISOString()
        };

    },

    async execute(task = {}) {

        const payload = task.payload || {};
        const plan = payload.plan || task.plan || {};

        const action = String(
            task.action ||
            payload.action ||
            plan.action ||
            task.type ||
            "BUILD_CAPABILITY"
        ).toUpperCase();

        const handler = ACTION_HANDLERS[action] || builder;

        try {

            if (typeof handler.execute === "function") {
                return await handler.execute(task);
            }

            if (typeof handler.run === "function") {
                return await handler.run(task);
            }

            throw new Error(
                `Handler for "${action}" exposes neither execute() nor run().`
            );

        } catch (err) {

            throw new Error(
                `[MILES CONNECTOR] ${action} failed: ${err.message}`
            );

        }

    },

    async shutdown() {

        return {
            ok: true
        };

    }

};