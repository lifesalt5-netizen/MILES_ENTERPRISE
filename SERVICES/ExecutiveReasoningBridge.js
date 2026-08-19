"use strict";

/**
 * MILES Executive Reasoning Bridge
 *
 * Purpose:
 *   1. Receive a natural-language executive objective.
 *   2. Gather current MILES business state.
 *   3. Request a structured plan from OpenAI.
 *   4. Validate the plan.
 *   5. submit the objective/plan through MILES' normal workflow path.
 *   6. Return a concise executive result.
 *
 * Important:
 *   This service never calls operational providers directly.
 *
 * Required execution path:
 *   ExecutiveReasoningBridge
 *      -> WorkflowService / CapabilityService
 *      -> TaskQueue
 *      -> ExecutionService
 *      -> ProviderRegistry
 *      -> Provider
 *      -> Verification
 */

const crypto = require("crypto");

let OpenAI = null;

try {
  const OpenAIModule = require("openai");
  OpenAI = OpenAIModule.OpenAI || OpenAIModule.default || OpenAIModule;
} catch (_error) {
  OpenAI = null;
}

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const DEFAULT_TIMEOUT_MS = Number(
  process.env.MILES_EXECUTIVE_REASONING_TIMEOUT_MS || 120000
);
const DEFAULT_MAX_RETRIES = Number(
  process.env.MILES_EXECUTIVE_REASONING_MAX_RETRIES || 2
);
const DEFAULT_MAX_WORKFLOWS = Number(
  process.env.MILES_EXECUTIVE_REASONING_MAX_WORKFLOWS || 12
);

const PROTECTED_ACTION_PATTERNS = [
  /payment/i,
  /financial transfer/i,
  /wire transfer/i,
  /bank transfer/i,
  /sign contract/i,
  /execute contract/i,
  /legal agreement/i,
  /hire employee/i,
  /terminate employee/i,
  /fire employee/i,
  /change pricing/i,
  /pricing approval/i,
  /customer commitment/i,
  /bind(?:ing)? commitment/i,
  /launch campaign/i,
  /activate campaign/i,
  /send campaign/i,
  /purchase/i,
  /buy domain/i,
  /delete data/i,
  /delete campaign/i,
  /delete account/i
];

const EXECUTIVE_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "objective",
    "priority",
    "executive_summary",
    "reasoning_summary",
    "workflows",
    "risks",
    "requires_ceo_approval",
    "ceo_approval_reasons",
    "expected_outcomes",
    "next_recommendation"
  ],
  properties: {
    objective: {
      type: "string"
    },
    priority: {
      type: "integer",
      minimum: 1,
      maximum: 10
    },
    executive_summary: {
      type: "string"
    },
    reasoning_summary: {
      type: "string"
    },
    workflows: {
      type: "array",
      maxItems: DEFAULT_MAX_WORKFLOWS,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "sequence",
          "title",
          "department",
          "capability",
          "provider",
          "action",
          "task_type",
          "priority",
          "depends_on",
          "expected_output",
          "verification",
          "requires_ceo_approval"
        ],
        properties: {
          sequence: {
            type: "integer",
            minimum: 1
          },
          title: {
            type: "string"
          },
          department: {
            type: "string"
          },
          capability: {
            type: "string"
          },
          provider: {
            type: "string"
          },
          action: {
            type: "string"
          },
          task_type: {
            type: "string"
          },
          priority: {
            type: "integer",
            minimum: 1,
            maximum: 10
          },
          depends_on: {
            type: "array",
            items: {
              type: "integer"
            }
          },
          expected_output: {
            type: "string"
          },
          verification: {
            type: "string"
          },
          requires_ceo_approval: {
            type: "boolean"
          }
        }
      }
    },
    risks: {
      type: "array",
      items: {
        type: "string"
      }
    },
    requires_ceo_approval: {
      type: "boolean"
    },
    ceo_approval_reasons: {
      type: "array",
      items: {
        type: "string"
      }
    },
    expected_outcomes: {
      type: "array",
      items: {
        type: "string"
      }
    },
    next_recommendation: {
      type: "string"
    }
  }
};

function createRequestId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `executive-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeString(value, fallback = "") {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value).trim();
}

function safelySerialize(value, maxLength = 60000) {
  const seen = new WeakSet();

  const serialized = JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item === "bigint") {
        return item.toString();
      }

      if (item && typeof item === "object") {
        if (seen.has(item)) {
          return "[Circular]";
        }

        seen.add(item);
      }

      if (
        typeof item === "string" &&
        item.length > 10000
      ) {
        return `${item.slice(0, 10000)}...[truncated]`;
      }

      return item;
    },
    2
  );

  if (!serialized) {
    return "{}";
  }

  if (serialized.length <= maxLength) {
    return serialized;
  }

  return `${serialized.slice(0, maxLength)}\n...[business state truncated]`;
}

class ExecutiveReasoningBridge {
  constructor(options = {}) {
    this.workflowService =
      options.workflowService || null;

    this.capabilityService =
      options.capabilityService || null;

    this.executionService =
      options.executionService || null;

    this.verificationService =
      options.verificationService || null;

    this.providerRegistry =
      options.providerRegistry || null;

    this.businessStateService =
      options.businessStateService || null;

    this.liveBusinessStateService =
      options.liveBusinessStateService || null;

    this.connectorManager =
      options.connectorManager || null;

    this.taskQueue =
      options.taskQueue || null;

    this.eventBus =
      options.eventBus || null;

    this.logger =
      options.logger || console;

    this.model =
      options.model || DEFAULT_MODEL;

    this.timeoutMs =
      Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);

    this.maxRetries =
      Number.isFinite(Number(options.maxRetries))
        ? Number(options.maxRetries)
        : DEFAULT_MAX_RETRIES;

    this.maxWorkflows =
      Number(
        options.maxWorkflows ||
          DEFAULT_MAX_WORKFLOWS
      );

    this.openAIClient =
      options.openAIClient || this.createOpenAIClient();

    this.activeRequests = new Map();
    this.history = [];
    this.maxHistory =
      Number(options.maxHistory || 100);

    this.metrics = {
      objectivesReceived: 0,
      plansGenerated: 0,
      plansRejected: 0,
      workflowsSubmitted: 0,
      approvalsRequired: 0,
      failures: 0,
      lastObjectiveAt: null,
      lastSuccessAt: null,
      lastFailureAt: null
    };
  }

  createOpenAIClient() {
    if (!OpenAI) {
      return null;
    }

    if (!process.env.OPENAI_API_KEY) {
      return null;
    }

    return new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: this.timeoutMs,
      maxRetries: 0
    });
  }

  log(level, message, metadata = {}) {
    const payload = {
      service: "ExecutiveReasoningBridge",
      ...metadata
    };

    const loggerMethod =
      this.logger &&
      typeof this.logger[level] === "function"
        ? this.logger[level].bind(this.logger)
        : console.log.bind(console);

    loggerMethod(
      `[EXECUTIVE REASONING BRIDGE] ${message}`,
      payload
    );
  }

  emit(eventName, payload) {
    try {
      if (
        this.eventBus &&
        typeof this.eventBus.emit === "function"
      ) {
        this.eventBus.emit(eventName, payload);
      }
    } catch (error) {
      this.log("warn", "Event emission failed.", {
        eventName,
        error: error.message
      });
    }
  }

  healthCheck() {
    const issues = [];

    if (!this.openAIClient) {
      issues.push(
        "OpenAI client unavailable. Confirm the openai package and OPENAI_API_KEY."
      );
    }

    if (
      !this.workflowService &&
      !this.capabilityService
    ) {
      issues.push(
        "No WorkflowService or CapabilityService was injected."
      );
    }

    return {
      ok: issues.length === 0,
      status:
        issues.length === 0 ? "HEALTHY" : "DEGRADED",
      service: "ExecutiveReasoningBridge",
      model: this.model,
      activeRequests: this.activeRequests.size,
      metrics: { ...this.metrics },
      issues
    };
  }

  getStatus() {
    return this.healthCheck();
  }

  getMetrics() {
    return {
      ...this.metrics,
      activeRequests: this.activeRequests.size,
      historyCount: this.history.length
    };
  }

  getHistory(limit = 20) {
    const safeLimit = Math.max(
      1,
      Math.min(Number(limit) || 20, 100)
    );

    return this.history.slice(-safeLimit);
  }

  async executeExecutiveObjective(
    objective,
    options = {}
  ) {
    const normalizedObjective =
      normalizeString(objective);

    if (!normalizedObjective) {
      throw new Error(
        "Executive objective is required."
      );
    }

    if (normalizedObjective.length > 10000) {
      throw new Error(
        "Executive objective exceeds the 10,000-character limit."
      );
    }

    if (!this.openAIClient) {
      throw new Error(
        "OpenAI is not configured. Install the openai package and set OPENAI_API_KEY."
      );
    }

    const requestId =
      options.requestId || createRequestId();

    const startedAt = new Date().toISOString();

    const requestRecord = {
      requestId,
      objective: normalizedObjective,
      status: "STARTED",
      startedAt,
      updatedAt: startedAt
    };

    this.activeRequests.set(
      requestId,
      requestRecord
    );

    this.metrics.objectivesReceived += 1;
    this.metrics.lastObjectiveAt = startedAt;

    this.emit("executive.objective.received", {
      requestId,
      objective: normalizedObjective,
      startedAt
    });

    this.log("info", "Executive objective received.", {
      requestId,
      objective: normalizedObjective
    });

    try {
      this.updateActiveRequest(
        requestId,
        "GATHERING_BUSINESS_STATE"
      );

      const businessState =
        options.businessState ||
        (await this.gatherBusinessState());

      this.updateActiveRequest(
        requestId,
        "REQUESTING_REASONING"
      );

      const rawPlan =
        await this.requestExecutiveReasoning({
          requestId,
          objective: normalizedObjective,
          businessState,
          options
        });

      this.updateActiveRequest(
        requestId,
        "VALIDATING_PLAN"
      );

      const plan =
        this.validateExecutivePlan(
          rawPlan,
          normalizedObjective
        );

      this.metrics.plansGenerated += 1;

      const protectedReview =
        this.applyProtectedActionRules(plan);

      const safePlan = protectedReview.plan;

      if (
        safePlan.requires_ceo_approval ||
        protectedReview.protectedWorkflowCount > 0
      ) {
        this.metrics.approvalsRequired += 1;
      }

      let submissionResult = null;

      if (options.reasonOnly === true) {
        this.updateActiveRequest(
          requestId,
          "REASONING_COMPLETE"
        );
      } else {
        this.updateActiveRequest(
          requestId,
          "SUBMITTING_WORK"
        );

        submissionResult =
          await this.submitPlanToMiles({
            requestId,
            objective: normalizedObjective,
            plan: safePlan,
            businessState,
            options
          });
      }

      const result =
        this.buildExecutiveResult({
          requestId,
          objective: normalizedObjective,
          plan: safePlan,
          businessState,
          submissionResult,
          startedAt,
          protectedReview
        });

      this.metrics.lastSuccessAt =
        new Date().toISOString();

      this.updateActiveRequest(
        requestId,
        "COMPLETED",
        result
      );

      this.addHistory({
        requestId,
        objective: normalizedObjective,
        status: "COMPLETED",
        startedAt,
        completedAt: result.completedAt,
        plan: safePlan,
        submissionResult
      });

      this.emit(
        "executive.objective.completed",
        result
      );

      this.log(
        "info",
        "Executive objective completed.",
        {
          requestId,
          workflows:
            safePlan.workflows.length,
          requiresCEOApproval:
            safePlan.requires_ceo_approval
        }
      );

      return result;
    } catch (error) {
      this.metrics.failures += 1;
      this.metrics.lastFailureAt =
        new Date().toISOString();

      this.updateActiveRequest(
        requestId,
        "FAILED",
        {
          error: error.message
        }
      );

      this.addHistory({
        requestId,
        objective: normalizedObjective,
        status: "FAILED",
        startedAt,
        completedAt: new Date().toISOString(),
        error: error.message,
        stack: error.stack
      });

      this.emit("executive.objective.failed", {
        requestId,
        objective: normalizedObjective,
        error: error.message
      });

      this.log("error", "Executive objective failed.", {
        requestId,
        objective: normalizedObjective,
        error: error.message,
        stack: error.stack
      });

      throw error;
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  updateActiveRequest(
    requestId,
    status,
    extra = {}
  ) {
    const current =
      this.activeRequests.get(requestId) || {
        requestId
      };

    this.activeRequests.set(requestId, {
      ...current,
      ...extra,
      status,
      updatedAt: new Date().toISOString()
    });
  }

  addHistory(record) {
    this.history.push(record);

    if (this.history.length > this.maxHistory) {
      this.history.splice(
        0,
        this.history.length - this.maxHistory
      );
    }
  }

  async gatherBusinessState() {
    const state = {
      gatheredAt: new Date().toISOString(),
      serviceHealth: {},
      business: {},
      providers: [],
      connectors: [],
      queue: {},
      warnings: []
    };

    await this.collectBusinessState(state);
    this.collectProviderState(state);
    this.collectConnectorState(state);
    await this.collectQueueState(state);
    this.collectServiceHealth(state);

    return state;
  }

  async collectBusinessState(state) {
    const candidates = [
      this.businessStateService,
      this.liveBusinessStateService
    ].filter(Boolean);

    for (const service of candidates) {
      const methods = [
        "getBusinessState",
        "getCurrentState",
        "getState",
        "getSummary",
        "snapshot",
        "refresh"
      ];

      for (const methodName of methods) {
        if (
          typeof service[methodName] !== "function"
        ) {
          continue;
        }

        try {
          const value =
            await service[methodName]();

          if (value !== undefined) {
            state.business = value;
            state.businessSource =
              `${service.constructor?.name || "BusinessStateService"}.${methodName}`;

            return;
          }
        } catch (error) {
          state.warnings.push(
            `Business state method ${methodName} failed: ${error.message}`
          );
        }
      }
    }

    state.warnings.push(
      "No compatible business-state method returned data."
    );
  }

  collectProviderState(state) {
    if (!this.providerRegistry) {
      state.warnings.push(
        "ProviderRegistry was not injected."
      );
      return;
    }

    try {
      if (
        typeof this.providerRegistry.list ===
        "function"
      ) {
        state.providers =
          this.providerRegistry.list();
        return;
      }

      if (
        typeof this.providerRegistry.getAll ===
        "function"
      ) {
        state.providers =
          this.providerRegistry.getAll();
        return;
      }

      if (
        this.providerRegistry.providers instanceof Map
      ) {
        state.providers = Array.from(
          this.providerRegistry.providers.entries()
        ).map(([id, provider]) => ({
          id,
          connector:
            provider?.connector || null,
          capabilities:
            provider?.capabilities || []
        }));
      }
    } catch (error) {
      state.warnings.push(
        `Provider state collection failed: ${error.message}`
      );
    }
  }

  collectConnectorState(state) {
    if (!this.connectorManager) {
      state.warnings.push(
        "ConnectorManager was not injected."
      );
      return;
    }

    try {
      if (
        typeof this.connectorManager.list ===
        "function"
      ) {
        state.connectors =
          this.connectorManager.list();
        return;
      }

      if (
        typeof this.connectorManager.getAll ===
        "function"
      ) {
        state.connectors =
          this.connectorManager.getAll();
        return;
      }

      const possibleMaps = [
        this.connectorManager.connectors,
        this.connectorManager.registry,
        this.connectorManager._connectors
      ];

      const connectorMap = possibleMaps.find(
        (value) => value instanceof Map
      );

      if (connectorMap) {
        state.connectors = Array.from(
          connectorMap.keys()
        );
      }
    } catch (error) {
      state.warnings.push(
        `Connector state collection failed: ${error.message}`
      );
    }
  }

  async collectQueueState(state) {
    if (!this.taskQueue) {
      state.warnings.push(
        "TaskQueue was not injected."
      );
      return;
    }

    const methods = [
      "getStats",
      "stats",
      "getStatus",
      "getSummary",
      "snapshot"
    ];

    for (const methodName of methods) {
      if (
        typeof this.taskQueue[methodName] !==
        "function"
      ) {
        continue;
      }

      try {
        state.queue =
          (await this.taskQueue[methodName]()) ||
          {};

        return;
      } catch (error) {
        state.warnings.push(
          `Queue method ${methodName} failed: ${error.message}`
        );
      }
    }
  }

  collectServiceHealth(state) {
    const services = {
      workflowService: this.workflowService,
      capabilityService: this.capabilityService,
      executionService: this.executionService,
      verificationService:
        this.verificationService,
      providerRegistry: this.providerRegistry,
      businessStateService:
        this.businessStateService,
      liveBusinessStateService:
        this.liveBusinessStateService,
      connectorManager: this.connectorManager,
      taskQueue: this.taskQueue
    };

    for (const [name, service] of Object.entries(
      services
    )) {
      if (!service) {
        state.serviceHealth[name] = {
          available: false
        };
        continue;
      }

      try {
        let health = null;

        if (
          typeof service.healthCheck ===
          "function"
        ) {
          health = service.healthCheck();
        } else if (
          typeof service.getStatus ===
          "function"
        ) {
          health = service.getStatus();
        }

        state.serviceHealth[name] = {
          available: true,
          health:
            health &&
            typeof health.then !== "function"
              ? health
              : null
        };
      } catch (error) {
        state.serviceHealth[name] = {
          available: true,
          error: error.message
        };
      }
    }
  }

  buildInstructions() {
    return `
You are the executive reasoning engine for MILES ENTERPRISE,
the autonomous Digital COO for Pathways 2 Government Contracting.

PRIMARY REVENUE TARGET:
Reach and sustainably maintain at least $10,000 per week in revenue.

OPERATING MODEL:
- ChatGPT performs executive reasoning.
- MILES plans, queues, executes, and verifies work.
- ORION provides government-contracting intelligence.
- Instantly provides outbound campaign operations.
- Google Workspace supports communication and business operations.
- Providers must never be called directly by this reasoning response.
- All operational work must flow through MILES WorkflowService,
  TaskQueue, ExecutionService, ProviderRegistry, and verification.

PRIORITY ORDER:
1. Immediate revenue and qualified sales activity.
2. Existing client delivery and retention.
3. Proposal and opportunity deadlines.
4. Follow-up and pipeline conversion.
5. Safe outbound growth and deliverability.
6. Business health and risk.
7. Infrastructure only when it blocks revenue or client delivery.

RULES:
- Base the plan on the supplied current business state.
- Do not claim that an action has already occurred.
- Produce executable workflows, not vague recommendations.
- Use only providers and capabilities that appear available.
- Mark uncertain provider assignments clearly.
- Do not invent client facts, credentials, approvals, or opportunity facts.
- Do not bypass MILES governance.
- Do not launch, activate, or send an outbound campaign without CEO approval
  unless the business state explicitly proves that standing authorization exists.
- Never authorize payments, transfers, contracts, legal commitments,
  personnel actions, pricing changes, purchases, irreversible deletion,
  or binding customer commitments without CEO approval.
- Favor a small number of high-impact workflows over excessive internal tasks.
- Every workflow must have a concrete expected output and verification test.
- Dependencies must reference workflow sequence numbers.
- Return only the requested structured JSON.
`.trim();
  }

  buildReasoningInput({
    requestId,
    objective,
    businessState
  }) {
    return `
EXECUTIVE REQUEST ID:
${requestId}

CEO OBJECTIVE:
${objective}

CURRENT BUSINESS STATE:
${safelySerialize(businessState)}

Create the highest-value executable plan for this objective.

The plan must:
- advance the $10,000-per-week revenue target;
- preserve deliverability and provider safety;
- use MILES' normal workflow and execution path;
- separate autonomous work from CEO-protected actions;
- avoid unnecessary infrastructure work;
- specify exact expected outputs and verification requirements.
`.trim();
  }

  async requestExecutiveReasoning({
    requestId,
    objective,
    businessState
  }) {
    let lastError = null;

    for (
      let attempt = 0;
      attempt <= this.maxRetries;
      attempt += 1
    ) {
      try {
        const response =
          await this.withTimeout(
            this.openAIClient.responses.create({
              model: this.model,
              instructions:
                this.buildInstructions(),
              input: this.buildReasoningInput({
                requestId,
                objective,
                businessState
              }),
              text: {
                format: {
                  type: "json_schema",
                  name: "miles_executive_plan",
                  strict: true,
                  schema: EXECUTIVE_PLAN_SCHEMA
                }
              },
              metadata: {
                service:
                  "MILES_EXECUTIVE_REASONING_BRIDGE",
                request_id: requestId
              }
            }),
            this.timeoutMs,
            "OpenAI executive reasoning request timed out."
          );

        const outputText =
          normalizeString(response?.output_text);

        if (!outputText) {
          throw new Error(
            "OpenAI returned no output_text."
          );
        }

        let parsed;

        try {
          parsed = JSON.parse(outputText);
        } catch (error) {
          throw new Error(
            `OpenAI response was not valid JSON: ${error.message}`
          );
        }

        return parsed;
      } catch (error) {
        lastError = error;

        this.log(
          attempt < this.maxRetries
            ? "warn"
            : "error",
          "Executive reasoning request failed.",
          {
            requestId,
            attempt: attempt + 1,
            maxAttempts:
              this.maxRetries + 1,
            error: error.message
          }
        );

        if (attempt < this.maxRetries) {
          await delay(
            Math.min(
              1000 * 2 ** attempt,
              8000
            )
          );
        }
      }
    }

    throw new Error(
      `Executive reasoning failed after ${
        this.maxRetries + 1
      } attempts: ${lastError?.message || "Unknown error"}`
    );
  }

  async withTimeout(
    promise,
    timeoutMs,
    message
  ) {
    let timeoutHandle;

    const timeoutPromise = new Promise(
      (_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }
    );

    try {
      return await Promise.race([
        promise,
        timeoutPromise
      ]);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  validateExecutivePlan(plan, objective) {
    if (!plan || typeof plan !== "object") {
      this.metrics.plansRejected += 1;
      throw new Error(
        "Executive plan must be an object."
      );
    }

    if (!Array.isArray(plan.workflows)) {
      this.metrics.plansRejected += 1;
      throw new Error(
        "Executive plan workflows must be an array."
      );
    }

    if (
      plan.workflows.length >
      this.maxWorkflows
    ) {
      this.metrics.plansRejected += 1;
      throw new Error(
        `Executive plan exceeds the maximum of ${this.maxWorkflows} workflows.`
      );
    }

    const normalizedWorkflows =
      plan.workflows.map(
        (workflow, index) => {
          const sequence =
            Number(workflow.sequence) ||
            index + 1;

          const requiredText = [
            "title",
            "department",
            "capability",
            "provider",
            "action",
            "task_type",
            "expected_output",
            "verification"
          ];

          for (const field of requiredText) {
            if (
              !normalizeString(
                workflow[field]
              )
            ) {
              this.metrics.plansRejected += 1;

              throw new Error(
                `Workflow ${sequence} is missing ${field}.`
              );
            }
          }

          return {
            sequence,
            title:
              normalizeString(
                workflow.title
              ),
            department:
              normalizeString(
                workflow.department
              ),
            capability:
              normalizeString(
                workflow.capability
              ),
            provider:
              normalizeString(
                workflow.provider
              ),
            action:
              normalizeString(
                workflow.action
              ),
            task_type:
              normalizeString(
                workflow.task_type
              ),
            priority: Math.max(
              1,
              Math.min(
                Number(workflow.priority) ||
                  Number(plan.priority) ||
                  5,
                10
              )
            ),
            depends_on: Array.isArray(
              workflow.depends_on
            )
              ? workflow.depends_on
                  .map(Number)
                  .filter(Number.isFinite)
              : [],
            expected_output:
              normalizeString(
                workflow.expected_output
              ),
            verification:
              normalizeString(
                workflow.verification
              ),
            requires_ceo_approval:
              Boolean(
                workflow.requires_ceo_approval
              )
          };
        }
      );

    const sequenceSet = new Set(
      normalizedWorkflows.map(
        (workflow) => workflow.sequence
      )
    );

    if (
      sequenceSet.size !==
      normalizedWorkflows.length
    ) {
      this.metrics.plansRejected += 1;
      throw new Error(
        "Workflow sequence numbers must be unique."
      );
    }

    for (const workflow of normalizedWorkflows) {
      for (const dependency of workflow.depends_on) {
        if (!sequenceSet.has(dependency)) {
          this.metrics.plansRejected += 1;
          throw new Error(
            `Workflow ${workflow.sequence} references missing dependency ${dependency}.`
          );
        }

        if (dependency === workflow.sequence) {
          this.metrics.plansRejected += 1;
          throw new Error(
            `Workflow ${workflow.sequence} cannot depend on itself.`
          );
        }
      }
    }

    return {
      objective:
        normalizeString(plan.objective) ||
        objective,
      priority: Math.max(
        1,
        Math.min(
          Number(plan.priority) || 5,
          10
        )
      ),
      executive_summary:
        normalizeString(
          plan.executive_summary
        ),
      reasoning_summary:
        normalizeString(
          plan.reasoning_summary
        ),
      workflows: normalizedWorkflows,
      risks: Array.isArray(plan.risks)
        ? plan.risks
            .map((risk) =>
              normalizeString(risk)
            )
            .filter(Boolean)
        : [],
      requires_ceo_approval:
        Boolean(
          plan.requires_ceo_approval
        ),
      ceo_approval_reasons:
        Array.isArray(
          plan.ceo_approval_reasons
        )
          ? plan.ceo_approval_reasons
              .map((reason) =>
                normalizeString(reason)
              )
              .filter(Boolean)
          : [],
      expected_outcomes:
        Array.isArray(
          plan.expected_outcomes
        )
          ? plan.expected_outcomes
              .map((outcome) =>
                normalizeString(outcome)
              )
              .filter(Boolean)
          : [],
      next_recommendation:
        normalizeString(
          plan.next_recommendation
        )
    };
  }

  applyProtectedActionRules(plan) {
    let protectedWorkflowCount = 0;

    const workflows = plan.workflows.map(
      (workflow) => {
        const searchableText = [
          workflow.title,
          workflow.capability,
          workflow.provider,
          workflow.action,
          workflow.expected_output
        ].join(" ");

        const protectedByRule =
          PROTECTED_ACTION_PATTERNS.some(
            (pattern) =>
              pattern.test(searchableText)
          );

        const requiresCEOApproval =
          workflow.requires_ceo_approval ||
          protectedByRule;

        if (requiresCEOApproval) {
          protectedWorkflowCount += 1;
        }

        return {
          ...workflow,
          requires_ceo_approval:
            requiresCEOApproval,
          status: requiresCEOApproval
            ? "PENDING_CEO_APPROVAL"
            : "READY_FOR_WORKFLOW"
        };
      }
    );

    const approvalReasons = [
      ...plan.ceo_approval_reasons
    ];

    if (
      protectedWorkflowCount > 0 &&
      approvalReasons.length === 0
    ) {
      approvalReasons.push(
        `${protectedWorkflowCount} workflow(s) contain CEO-protected actions.`
      );
    }

    return {
      plan: {
        ...plan,
        workflows,
        requires_ceo_approval:
          plan.requires_ceo_approval ||
          protectedWorkflowCount > 0,
        ceo_approval_reasons:
          approvalReasons
      },
      protectedWorkflowCount
    };
  }

  async submitPlanToMiles({
    requestId,
    objective,
    plan,
    businessState,
    options
  }) {
    const executableWorkflows =
      plan.workflows.filter(
        (workflow) =>
          !workflow.requires_ceo_approval
      );

    const protectedWorkflows =
      plan.workflows.filter(
        (workflow) =>
          workflow.requires_ceo_approval
      );

    const payload = {
      requestId,
      source:
        "ExecutiveReasoningBridge",
      objective,
      priority: plan.priority,
      reasoning:
        plan.reasoning_summary,
      executiveSummary:
        plan.executive_summary,
      expectedOutcomes:
        plan.expected_outcomes,
      risks: plan.risks,
      workflows: executableWorkflows,
      protectedWorkflows,
      requiresCEOApproval:
        plan.requires_ceo_approval,
      verificationRequired: true,
      businessStateTimestamp:
        businessState?.gatheredAt || null,
      metadata: {
        revenueTargetWeekly: 10000,
        createdAt:
          new Date().toISOString(),
        model: this.model
      }
    };

    const service =
      this.workflowService ||
      this.capabilityService;

    if (!service) {
      throw new Error(
        "No WorkflowService or CapabilityService is available for plan submission."
      );
    }

    const submission =
      await this.invokeWorkflowService(
        service,
        payload,
        objective,
        plan,
        options
      );

    this.metrics.workflowsSubmitted +=
      executableWorkflows.length;

    this.emit(
      "executive.plan.submitted",
      {
        requestId,
        objective,
        executableWorkflows:
          executableWorkflows.length,
        protectedWorkflows:
          protectedWorkflows.length,
        submission
      }
    );

    return {
      submitted: true,
      executableWorkflowCount:
        executableWorkflows.length,
      protectedWorkflowCount:
        protectedWorkflows.length,
      submission
    };
  }

  async invokeWorkflowService(
    service,
    payload,
    objective,
    plan,
    options
  ) {
    const attempts = [
      {
        method:
          "createExecutiveWorkflow",
        args: [payload]
      },
      {
        method: "createWorkflow",
        args: [payload]
      },
      {
        method: "submitPlan",
        args: [payload]
      },
      {
        method: "submitWorkPackage",
        args: [payload]
      },
      {
        method: "enqueueWorkflow",
        args: [payload]
      },
      {
        method: "planObjective",
        args: [
          objective,
          {
            source:
              "ExecutiveReasoningBridge",
            executivePlan: plan,
            requestId:
              payload.requestId,
            autoExecute:
              options.autoExecute !==
              false
          }
        ]
      }
    ];

    const availableMethods = attempts.filter(
      ({ method }) =>
        typeof service[method] === "function"
    );

    if (availableMethods.length === 0) {
      throw new Error(
        `No compatible workflow submission method was found on ${
          service.constructor?.name ||
          "workflow service"
        }. Expected one of: ${attempts
          .map((item) => item.method)
          .join(", ")}.`
      );
    }

    let lastError = null;

    for (const attempt of availableMethods) {
      try {
        this.log(
          "info",
          "Submitting executive plan through MILES.",
          {
            requestId:
              payload.requestId,
            service:
              service.constructor?.name ||
              "WorkflowService",
            method: attempt.method
          }
        );

        const result =
          await service[attempt.method](
            ...attempt.args
          );

        if (result === false) {
          throw new Error(
            `${attempt.method} returned false.`
          );
        }

        return {
          service:
            service.constructor?.name ||
            "WorkflowService",
          method: attempt.method,
          result
        };
      } catch (error) {
        lastError = error;

        this.log(
          "warn",
          "Workflow submission method failed.",
          {
            requestId:
              payload.requestId,
            method: attempt.method,
            error: error.message
          }
        );
      }
    }

    throw new Error(
      `All compatible workflow submission methods failed: ${
        lastError?.message ||
        "Unknown workflow error"
      }`
    );
  }

  buildExecutiveResult({
    requestId,
    objective,
    plan,
    submissionResult,
    startedAt,
    protectedReview
  }) {
    const completedAt =
      new Date().toISOString();

    return {
      ok: true,
      requestId,
      status:
        submissionResult
          ? "SUBMITTED_TO_MILES"
          : "REASONING_COMPLETE",
      objective,
      target: {
        weeklyRevenue: 10000
      },
      executiveSummary:
        plan.executive_summary,
      reasoningSummary:
        plan.reasoning_summary,
      priority: plan.priority,
      workflows: plan.workflows,
      workflowCount:
        plan.workflows.length,
      autonomousWorkflowCount:
        plan.workflows.filter(
          (workflow) =>
            !workflow.requires_ceo_approval
        ).length,
      protectedWorkflowCount:
        protectedReview.protectedWorkflowCount,
      requiresCEOApproval:
        plan.requires_ceo_approval,
      ceoApprovalReasons:
        plan.ceo_approval_reasons,
      risks: plan.risks,
      expectedOutcomes:
        plan.expected_outcomes,
      nextRecommendation:
        plan.next_recommendation,
      submission:
        submissionResult,
      startedAt,
      completedAt,
      durationMs:
        new Date(completedAt).getTime() -
        new Date(startedAt).getTime()
    };
  }
}

module.exports =
  ExecutiveReasoningBridge;
module.exports.ExecutiveReasoningBridge =
  ExecutiveReasoningBridge;
module.exports.EXECUTIVE_PLAN_SCHEMA =
  EXECUTIVE_PLAN_SCHEMA;