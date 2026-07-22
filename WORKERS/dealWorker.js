"use strict";

const { bus } =
    require("../event-bus/emitter");

const DealClosureEngine =
    require("../SERVICES/DealClosureEngine");

const DealLifecycleService =
    require("../SERVICES/DealLifecycleService");

const closureEngine =
    new DealClosureEngine({
        connectors: {}
    });

const lifecycle =
    new DealLifecycleService();

function extractQualifiedRecords(data = {}) {
    const candidates = [
        data?.results?.qualified,
        data?.qualified,
        data?.results?.qualifiedLeads,
        data?.qualifiedLeads,
        data?.results?.deals,
        data?.deals
    ];

    return (
        candidates.find(Array.isArray) ||
        []
    );
}

bus.on(
    "REVENUE_RESULT",
    async data => {
        try {
            const qualified =
                extractQualifiedRecords(data);

            console.log(
                `[DEAL WORKER] Qualified records received: ${qualified.length}`
            );

            const lifecycleResult =
                lifecycle.upsertMany(
                    qualified
                );

            console.log(
                [
                    "[DEAL WORKER]",
                    `Created: ${lifecycleResult.created}`,
                    `Updated: ${lifecycleResult.updated}`,
                    `Total: ${lifecycleResult.totalDeals}`
                ].join(" ")
            );

            const closureResult =
                await closureEngine.run(
                    lifecycleResult.deals
                );

            const result = {
                ok: true,
                generatedAt:
                    new Date().toISOString(),

                lifecycle:
                    lifecycleResult,

                closure:
                    closureResult,

                deals:
                    lifecycleResult.deals
            };

            bus.emit(
                "DEAL_RESULT",
                result
            );
        } catch (error) {
            console.error(
                "[DEAL WORKER] Failure:",
                error
            );

            bus.emit(
                "DEAL_RESULT",
                {
                    ok: false,
                    generatedAt:
                        new Date().toISOString(),
                    error:
                        error.message
                }
            );
        }
    }
);

module.exports = {
    lifecycle,
    closureEngine,
    extractQualifiedRecords
};
