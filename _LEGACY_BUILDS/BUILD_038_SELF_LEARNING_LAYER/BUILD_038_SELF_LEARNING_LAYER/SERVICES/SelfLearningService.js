"use strict";

/**
 * MILES Self Learning Service
 * BUILD_038
 * Learns from decisions, failures, routing, priorities, and runtime history.
 */

const fs = require("fs");
const path = require("path");

const LearningDataService = require("./LearningDataService");
const DecisionLearningService = require("./DecisionLearningService");
const FailureLearningService = require("./FailureLearningService");
const RoutingLearningService = require("./RoutingLearningService");
const PriorityOptimizationService = require("./PriorityOptimizationService");
const ConfidenceScoringService = require("./ConfidenceScoringService");
const RecommendationEngineService = require("./RecommendationEngineService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "self_learning");
const LATEST = path.join(OUT_DIR, "latest_learning_state.json");
const HISTORY = path.join(OUT_DIR, "learning_history.json");
const RECOMMENDATIONS = path.join(OUT_DIR, "learning_recommendations.json");
const REPORT = path.join(OUT_DIR, "self_learning_report.md");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) { try { if (!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }

class SelfLearningService {
    run(input = {}) {
        const startedAt = Date.now();
        console.log("");
        console.log("========================================");
        console.log(" BUILD_038 Self Learning Layer");
        console.log("========================================");

        const data = LearningDataService.collect();
        const decision = DecisionLearningService.run(data);
        const failure = FailureLearningService.run(data);
        const routing = RoutingLearningService.run(data);
        const priority = PriorityOptimizationService.run(data);
        const confidence = ConfidenceScoringService.run({ decisionLearning: decision, failureLearning: failure, routingLearning: routing, priorityLearning: priority });
        const recommendationEngine = RecommendationEngineService.run({ decision, failure, routing, priority, confidence });

        const state = {
            ok: true,
            action: "SELF_LEARNING",
            type: "MILES_SELF_LEARNING_STATE",
            build: "BUILD_038",
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            source: input.source || "SelfLearningService",
            decision,
            failure,
            routing,
            priority,
            confidence,
            recommendations: recommendationEngine.recommendations,
            summary: {
                confidenceScore: confidence.score,
                confidenceStatus: confidence.status,
                decisionSampleSize: decision.sampleSize,
                routeRate: routing.routeRate,
                failedWorkItems: failure.failedWorkItems,
                blockedWorkItems: failure.blockedWorkItems,
                openWork: priority.openWork,
                recommendations: recommendationEngine.count
            },
            outDir: OUT_DIR
        };

        this.save(state);

        console.log("");
        console.log("Self Learning Complete");
        console.log(`Confidence: ${state.confidence.status} (${state.confidence.score})`);
        console.log(`Recommendations: ${state.recommendations.length}`);
        console.log(`Open Work Learned: ${state.priority.openWork}`);
        console.log("");

        return state;
    }

    save(state) {
        ensureDir(OUT_DIR);
        writeJson(LATEST, state);
        writeJson(RECOMMENDATIONS, { generatedAt: state.generatedAt, recommendations: state.recommendations });
        const history = readJson(HISTORY, []);
        history.push({ generatedAt: state.generatedAt, summary: state.summary, confidence: state.confidence, recommendations: state.recommendations });
        writeJson(HISTORY, history.slice(-500));
        fs.writeFileSync(REPORT, this.renderReport(state), "utf8");
    }

    renderReport(state) {
        const recs = state.recommendations.length ? state.recommendations.map(r => `- ${r.severity} / ${r.area}: ${r.recommendation}`).join("\n") : "- No recommendations.";
        const reasons = state.confidence.reasons.length ? state.confidence.reasons.map(r => `- ${r}`).join("\n") : "- No confidence reasons recorded.";
        return `# MILES Self Learning Report\n\nGenerated: ${state.generatedAt}\n\n## Confidence\n\nStatus: ${state.confidence.status}  \nScore: ${state.confidence.score}\n\n## Summary\n\nDecision Sample Size: ${state.summary.decisionSampleSize}  \nRoute Rate: ${state.summary.routeRate}%  \nFailed Work Items: ${state.summary.failedWorkItems}  \nBlocked Work Items: ${state.summary.blockedWorkItems}  \nOpen Work: ${state.summary.openWork}  \nRecommendations: ${state.summary.recommendations}\n\n## Confidence Reasons\n\n${reasons}\n\n## Recommendations\n\n${recs}\n`;
    }
}

module.exports = new SelfLearningService();
