"use strict";

class BaseProvider {
  constructor(options = {}) {
    this.name = options.name || "BaseProvider";
  }

  async healthCheck() {
    return {
      provider: this.name,
      healthy: true,
      checkedAt: new Date().toISOString()
    };
  }

  async uploadSegment() {
    throw new Error(`${this.name} does not implement uploadSegment().`);
  }
}

module.exports = BaseProvider;
