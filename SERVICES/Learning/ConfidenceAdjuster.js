"use strict";

const scorer = require("./PerformanceScorer");

class ConfidenceAdjuster {

    adjust(provider, baseConfidence = 100) {

        const score = scorer.scoreProvider(provider);

        let adjusted =
            baseConfidence + score.confidenceModifier;

        adjusted = Math.max(0, Math.min(100, adjusted));

        return {
            provider,
            originalConfidence: baseConfidence,
            adjustedConfidence: adjusted,
            modifier: score.confidenceModifier,
            successRate: score.successRate
        };

    }

}

module.exports = new ConfidenceAdjuster();