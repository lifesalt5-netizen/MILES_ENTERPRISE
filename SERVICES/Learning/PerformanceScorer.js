"use strict";

const learning = require("./LearningEngine");

class PerformanceScorer {

    scoreProvider(providerName) {

        const report = learning.analyze();

        const provider =
            report.providers[providerName] || {
                total: 0,
                completed: 0,
                successRate: 50
            };

        return {
            provider: providerName,
            executions: provider.total,
            successRate: provider.successRate,
            confidenceModifier:
                provider.successRate >= 95 ? 10 :
                provider.successRate >= 80 ? 5 :
                provider.successRate >= 60 ? 0 :
                -10
        };
    }

}

module.exports = new PerformanceScorer();