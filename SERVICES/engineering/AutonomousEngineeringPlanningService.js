"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STOP_WORDS = new Set([
  "add", "and", "for", "from", "into", "miles", "the",
  "this", "that", "using", "with", "without", "system",
  "service", "feature", "change", "update", "fix"
]);

function tokenize(value) {
  return [
    ...new Set(
      String(value || "")
        .toLowerCase()
        .match(/[a-z0-9]+/g) || []
    )
  ].filter(token =>
    token.length >= 3 &&
    !STOP_WORDS.has(token)
  );
}

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .toUpperCase();
}

class AutonomousEngineeringPlanningService {
  constructor(options = {}) {
    this.service = "AUTONOMOUS_ENGINEERING_PLANNING";
    this.rootDir = path.resolve(
      options.rootDir ||
      process.env.MILES_ROOT ||
      path.resolve(__dirname, "..", "..")
    );
    this.graphPath =
      options.graphPath ||
      path.join(
        this.rootDir,
        "DATA",
        "runtime",
        "engineering",
        "repository_dependency_graph.json"
      );
    this.planRoot =
      options.planRoot ||
      path.join(
        this.rootDir,
        "DATA",
        "runtime",
        "engineering",
        "plans"
      );
    this.maxTargets = Number(options.maxTargets || 8);
    this.impactDepth = Number(options.impactDepth || 2);
    this.generatedAt =
      options.generatedAt ||
      (() => new Date().toISOString());
  }

  loadGraph() {
    if (!fs.existsSync(this.graphPath)) {
      throw new Error(
        "AUTHORITATIVE_REPOSITORY_GRAPH_MISSING"
      );
    }

    let graph;
    try {
      graph = JSON.parse(
        fs.readFileSync(this.graphPath, "utf8")
      );
    } catch (error) {
      throw new Error(
        `AUTHORITATIVE_REPOSITORY_GRAPH_INVALID: ${error.message}`
      );
    }

    if (
      graph.ok !== true ||
      graph.validation?.ok !== true ||
      !Array.isArray(graph.nodes) ||
      !Array.isArray(graph.edges) ||
      !/^[A-F0-9]{64}$/.test(graph.fingerprint || "")
    ) {
      throw new Error(
        "AUTHORITATIVE_REPOSITORY_GRAPH_FAILED_VALIDATION"
      );
    }

    return graph;
  }

  scoreNode(node, keywords) {
    const id = String(node.id || "").toLowerCase();
    const tokens = new Set(tokenize(id));
    let score = 0;
    const matches = [];

    for (const keyword of keywords) {
      if (tokens.has(keyword)) {
        score += 6;
        matches.push(keyword);
      } else if (id.includes(keyword)) {
        score += 3;
        matches.push(keyword);
      }
    }

    if (node.type === "TEST") score -= 1;
    if (node.type === "ENTRY_POINT") score += 1;

    return {
      node,
      score: Math.max(0, score),
      matches: [...new Set(matches)]
    };
  }

  selectTargets(graph, objective) {
    const keywords = tokenize(objective);
    if (keywords.length === 0) {
      throw new Error(
        "ENGINEERING_OBJECTIVE_HAS_NO_ACTIONABLE_TERMS"
      );
    }

    const ranked = graph.nodes
      .map(node => this.scoreNode(node, keywords))
      .filter(candidate => candidate.score > 0)
      .sort((first, second) =>
        second.score - first.score ||
        first.node.id.localeCompare(second.node.id)
      )
      .slice(0, this.maxTargets);

    if (ranked.length === 0) {
      throw new Error(
        "ENGINEERING_OBJECTIVE_HAS_NO_REPOSITORY_MATCH"
      );
    }

    return {
      keywords,
      ranked
    };
  }

  impactAnalysis(graph, selectedIds) {
    const reverse = new Map(
      graph.nodes.map(node => [node.id, []])
    );

    for (const edge of graph.edges) {
      if (reverse.has(edge.to)) {
        reverse.get(edge.to).push(edge.from);
      }
    }

    const impacted = new Map();
    let frontier = [...selectedIds];

    for (let depth = 1; depth <= this.impactDepth; depth += 1) {
      const next = [];
      for (const target of frontier) {
        for (const dependent of reverse.get(target) || []) {
          if (
            selectedIds.has(dependent) ||
            impacted.has(dependent)
          ) {
            continue;
          }
          impacted.set(dependent, depth);
          next.push(dependent);
        }
      }
      frontier = next;
    }

    return [...impacted.entries()]
      .map(([id, depth]) => ({
        id,
        depth,
        type:
          graph.nodes.find(node => node.id === id)?.type ||
          "SOURCE"
      }))
      .sort((first, second) =>
        first.depth - second.depth ||
        first.id.localeCompare(second.id)
      );
  }

  buildValidation(graph, targets, impacted) {
    const targetIds = new Set(
      targets.map(target => target.id)
    );
    const affectedTests = impacted
      .filter(item => item.type === "TEST")
      .map(item => item.id);

    const syntax = targets
      .filter(target =>
        /\.(?:js|cjs|mjs)$/i.test(target.id)
      )
      .map(target =>
        `node --check "${target.id}"`
      );

    const commands = [
      ...syntax,
      ...affectedTests.map(testFile =>
        `node "${testFile}"`
      )
    ];

    if (
      affectedTests.length === 0 &&
      graph.packageMetadata?.scripts?.test
    ) {
      commands.push("npm test");
    }

    return {
      syntax,
      affectedTests,
      commands: [...new Set(commands)],
      targetCount: targetIds.size,
      requiresNewTests: affectedTests.length === 0
    };
  }

  assessRisk(graph, targets, impacted) {
    const targetIds = new Set(
      targets.map(target => target.id)
    );
    const unresolved = (
      graph.unresolvedRelativeImports || []
    ).filter(item => targetIds.has(item.from));
    const cycles = (
      graph.dependencyCycles || []
    ).filter(cycle =>
      cycle.some(id => targetIds.has(id))
    );
    const sensitiveTargets = targets.filter(target =>
      ["CORE", "ENTRY_POINT"].includes(target.type)
    );

    let level = "LOW";
    if (
      sensitiveTargets.length > 0 ||
      cycles.length > 0 ||
      impacted.length > 25
    ) {
      level = "HIGH";
    } else if (
      unresolved.length > 0 ||
      impacted.length > 0
    ) {
      level = "MEDIUM";
    }

    return {
      level,
      sensitiveTargets:
        sensitiveTargets.map(target => target.id),
      unresolvedDependencies: unresolved,
      dependencyCycles: cycles,
      impactedFiles: impacted.length,
      productionAcceptanceRequired:
        level !== "LOW"
    };
  }

  createPlan(input = {}) {
    const objective = String(input.objective || "").trim();
    if (objective.length < 10) {
      throw new Error(
        "ENGINEERING_OBJECTIVE_REQUIRED"
      );
    }

    const graph = this.loadGraph();
    const selection = this.selectTargets(graph, objective);
    const targets = selection.ranked.map(candidate => ({
      id: candidate.node.id,
      type: candidate.node.type,
      score: candidate.score,
      matches: candidate.matches,
      directDependencies:
        candidate.node.dependencies || []
    }));
    const selectedIds = new Set(
      targets.map(target => target.id)
    );
    const impacted = this.impactAnalysis(
      graph,
      selectedIds
    );
    const validation = this.buildValidation(
      graph,
      targets,
      impacted
    );
    const risk = this.assessRisk(
      graph,
      targets,
      impacted
    );
    const identity = {
      objective,
      repositoryFingerprint: graph.fingerprint,
      targets: targets.map(target => target.id),
      impacted: impacted.map(item => item.id)
    };
    const planFingerprint = hash(identity);
    const planId =
      `ENGINEERING-PLAN-${planFingerprint.slice(0, 16)}`;

    return {
      ok: true,
      service: this.service,
      mode: "PLAN_ONLY",
      planId,
      planFingerprint,
      generatedAt: this.generatedAt(),
      objective,
      repository: {
        root: graph.root,
        fingerprint: graph.fingerprint,
        sourceFiles: graph.summary?.sourceFiles ?? null,
        internalDependencies:
          graph.summary?.internalDependencies ?? null
      },
      scope: {
        keywords: selection.keywords,
        targets,
        impacted
      },
      risk,
      validation,
      phases: [
        {
          phase: 1,
          name: "SCOPE_CONFIRMATION",
          status: "PLANNED",
          exitCriteria:
            "Repository fingerprint and target files confirmed."
        },
        {
          phase: 2,
          name: "SAFE_IMPLEMENTATION",
          status: "BLOCKED_PENDING_AUTHORIZATION",
          files: targets.map(target => target.id),
          exitCriteria:
            "Only approved files changed; unrelated worktree changes preserved."
        },
        {
          phase: 3,
          name: "VALIDATION",
          status: "PLANNED",
          commands: validation.commands,
          exitCriteria:
            "Syntax, targeted tests, and required regression tests pass."
        },
        {
          phase: 4,
          name: "EVIDENCE_COLLECTION",
          status: "PLANNED",
          exitCriteria:
            "Diff, tests, runtime evidence, and artifact hashes recorded."
        },
        {
          phase: 5,
          name: "GITHUB_GOVERNANCE",
          status: "BLOCKED_PENDING_AUTHORIZATION",
          exitCriteria:
            "Scoped branch and draft PR created; merge separately approved."
        }
      ],
      authorization: {
        sourceWritesAuthorized: false,
        gitWritesAuthorized: false,
        pullRequestAuthorized: false,
        mergeAuthorized: false,
        deploymentAuthorized: false,
        requiredApprovals: [
          "SOURCE_MODIFICATION",
          "GIT_COMMIT_AND_PUSH",
          "PULL_REQUEST",
          "MERGE",
          "PRODUCTION_DEPLOYMENT"
        ]
      }
    };
  }

  persistPlan(plan) {
    if (
      !plan ||
      plan.ok !== true ||
      !/^ENGINEERING-PLAN-[A-F0-9]{16}$/.test(plan.planId || "")
    ) {
      throw new Error(
        "ENGINEERING_PLAN_FAILED_VALIDATION"
      );
    }

    fs.mkdirSync(this.planRoot, {
      recursive: true
    });
    const filePath = path.join(
      this.planRoot,
      `${plan.planId}.json`
    );
    const temporary =
      `${filePath}.${process.pid}.${Date.now()}.tmp`;

    fs.writeFileSync(
      temporary,
      JSON.stringify(plan, null, 2),
      "utf8"
    );

    try {
      fs.renameSync(temporary, filePath);
    } catch {
      fs.copyFileSync(temporary, filePath);
      try {
        fs.unlinkSync(temporary);
      } catch {}
    }

    return {
      ok: true,
      filePath,
      bytes: fs.statSync(filePath).size,
      sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(filePath))
        .digest("hex")
        .toUpperCase(),
      planId: plan.planId,
      planFingerprint: plan.planFingerprint
    };
  }
}

module.exports = AutonomousEngineeringPlanningService;
module.exports.AutonomousEngineeringPlanningService =
  AutonomousEngineeringPlanningService;
module.exports.tokenize = tokenize;
