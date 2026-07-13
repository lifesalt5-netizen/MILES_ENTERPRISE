"use strict";

const memory = require("../Memory/OperationalMemoryService");

class LearningEngine {

    analyze() {

        const stats = memory.statistics();
        const recent = memory.recent(100);

        const providerScores = {};

        recent.forEach(exec => {

            const provider = exec.provider || "UNKNOWN";

            if (!providerScores[provider]) {
                providerScores[provider] = {
                    total: 0,
                    completed: 0
                };
            }

            providerScores[provider].total++;

            if (exec.status === "COMPLETED") {
                providerScores[provider].completed++;
            }

        });

        Object.values(providerScores).forEach(provider => {

            provider.successRate =
                provider.total === 0
                    ? 0
                    : Math.round((provider.completed/provider.total)*100);

        });

        return {

            ok:true,

            timestamp:new Date().toISOString(),

            totalExecutions:stats.totalExecutions,

            completed:stats.completed,

            failed:stats.failed,

            providers:providerScores

        };

    }

}

module.exports = new LearningEngine();