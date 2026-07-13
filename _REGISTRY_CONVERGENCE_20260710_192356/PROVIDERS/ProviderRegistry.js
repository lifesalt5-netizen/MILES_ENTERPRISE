"use strict";

const InstantlyProvider = require("../PROVIDERS/InstantlyProvider");

class ProviderRegistry {
  constructor() {
    this.providers = new Map();
    this.register("instantly", new InstantlyProvider());
  }

  register(name, provider) {
    this.providers.set(String(name).toLowerCase(), provider);
  }

  get(name) {
    const provider = this.providers.get(String(name).toLowerCase());
    if (!provider) throw new Error(`Provider not registered: ${name}`);
    return provider;
  }

  list() {
    return Array.from(this.providers.keys());
  }
}

module.exports = new ProviderRegistry();
