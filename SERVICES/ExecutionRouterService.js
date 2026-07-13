"use strict";

class ExecutionRouterService {

  constructor({ connectors }) {
    this.connectors = connectors;
  }

  // =========================
  // 🚀 MAIN ENTRY POINT
  // =========================
  async execute(actions = []) {

    const results = [];

    for (const action of actions) {

      const result = await this.route(action);

      results.push(result);
    }

    return results;
  }

  // =========================
  // 🧠 ROUTER LOGIC
  // =========================
  async route(action) {

    try {

      switch (action.type) {

        // 📬 EMAIL ROUTING
        case "EMAIL":
        case "GMAIL":

          if (!this.connectors?.email) {
            return this.fail("EMAIL connector missing", action);
          }

          return await this.connectors.email.send(action.payload);

        // ⚡ INSTANTLY ROUTING
        case "INSTANTLY":

          if (!this.connectors?.instantly) {
            return this.fail("INSTANTLY connector missing", action);
          }

          return await this.connectors.instantly.run(action.payload);

        // 🧠 CRM ROUTING
        case "CRM":

          if (!this.connectors?.crm) {
            return this.fail("CRM connector missing", action);
          }

          return await this.connectors.crm.update(action.payload);

        // 🌐 WEBHOOK ROUTING
        case "WEBHOOK":

          if (!this.connectors?.webhook) {
            return this.fail("WEBHOOK connector missing", action);
          }

          return await this.connectors.webhook.send(action.payload);

        default:

          return this.fail("UNKNOWN ACTION TYPE", action);
      }

    } catch (err) {

      return this.fail(err.message, action);
    }
  }

  // =========================
  // ❌ FAILURE HANDLER
  // =========================
  fail(reason, action) {

    return {
      ok: false,
      reason,
      action
    };
  }
}

module.exports = ExecutionRouterService;