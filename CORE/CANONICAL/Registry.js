"use strict";

class CanonicalRegistry {
  constructor(name) {
    this.name = name;
    this.items = new Map();
  }

  register(key, value) {
    if (!key) throw new Error(`${this.name}: key required`);
    this.items.set(key, {
      key,
      value,
      registeredAt: new Date().toISOString()
    });
    return this.items.get(key);
  }

  get(key) {
    return this.items.get(key)?.value || null;
  }

  list() {
    return Array.from(this.items.values());
  }

  has(key) {
    return this.items.has(key);
  }
}

module.exports = CanonicalRegistry;
