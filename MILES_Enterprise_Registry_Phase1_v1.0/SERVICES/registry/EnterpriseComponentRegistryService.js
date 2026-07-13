'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class EnterpriseComponentRegistryService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.cwd());
    this.runtimeDir = path.resolve(
      options.runtimeDir || path.join(this.rootDir, 'runtime', 'enterprise_registry')
    );
    this.registryPath = path.join(this.runtimeDir, 'component_registry.json');
    this.summaryPath = path.join(this.runtimeDir, 'component_registry_summary.json');
    this.changesPath = path.join(this.runtimeDir, 'component_registry_changes.json');
    this.service = 'ENTERPRISE_COMPONENT_REGISTRY';
    this.version = '1.0.0';

    this.excludedDirectories = new Set([
      'node_modules', '.git', '.vs', 'dist', 'build', 'coverage',
      'tmp', 'temp', 'logs', 'backups', 'archive', 'archives',
      '_REFERENCE', '_LEGACY_BUILDS'
    ]);

    this.allowedExtensions = new Set([
      '.js', '.cjs', '.mjs', '.ts', '.tsx', '.py', '.ps1',
      '.cs', '.json', '.md', '.csv', '.sql', '.html'
    ]);

    fs.mkdirSync(this.runtimeDir, { recursive: true });
  }

  now() {
    return new Date().toISOString();
  }

  safeRead(filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return '';
    }
  }

  hashText(text) {
    return crypto.createHash('sha256').update(text || '').digest('hex');
  }

  isExcluded(fullPath) {
    const relative = path.relative(this.rootDir, fullPath);
    if (!relative || relative.startsWith('..')) return false;
    return relative.split(path.sep).some(part =>
      this.excludedDirectories.has(part) || part.startsWith('_MILES_AUDIT_')
    );
  }

  walk(dir = this.rootDir, files = []) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return files;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (this.isExcluded(fullPath)) continue;

      if (entry.isDirectory()) {
        this.walk(fullPath, files);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (this.allowedExtensions.has(ext)) files.push(fullPath);
      }
    }

    return files;
  }

  classify(relativePath, content) {
    const value = `${relativePath}\n${content.slice(0, 4000)}`.toLowerCase();

    const rules = [
      ['WORKER', /\bworker\b/],
      ['PLANNER', /\bplanner\b/],
      ['CONNECTOR', /\bconnector\b/],
      ['PROVIDER', /\bprovider\b/],
      ['SCHEDULER', /\bscheduler|cron\b/],
      ['RUNTIME', /\bruntime|supervisor|bootstrap\b/],
      ['GOVERNANCE', /\bapproval|decision|authority|governance\b/],
      ['MEMORY', /\bmemory|knowledge|context\b/],
      ['LEARNING', /\blearning|optimization|feedback\b/],
      ['DASHBOARD', /\bdashboard|report|executive intelligence\b/],
      ['DATABASE', /\bdatabase|sqlite|schema|repository\b/],
      ['API', /\bapi|route|express\b/],
      ['TEST', /\btest|spec|healthcheck\b/]
    ];

    const categories = rules.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
    return categories.length ? categories : ['GENERAL'];
  }

  extractArray(text, propertyName) {
    const regex = new RegExp(`${propertyName}\\s*=\\s*(?:Array\\.from\\([^[]*)?\\[([\\s\\S]*?)\\]`, 'i');
    const match = text.match(regex);
    if (!match) return [];

    const values = [];
    const stringRegex = /['"`]([A-Z][A-Z0-9_]{2,})['"`]/g;
    let item;
    while ((item = stringRegex.exec(match[1])) !== null) values.push(item[1]);
    return [...new Set(values)];
  }

  extractExports(text) {
    const values = [];
    const patterns = [
      /module\.exports\s*=\s*([A-Za-z_$][\w$]*)/g,
      /exports\.([A-Za-z_$][\w$]*)\s*=/g,
      /export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g,
      /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) values.push(match[1]);
    }
    return [...new Set(values)];
  }

  extractClasses(text) {
    const values = [];
    const regex = /\bclass\s+([A-Za-z_$][\w$]*)/g;
    let match;
    while ((match = regex.exec(text)) !== null) values.push(match[1]);
    return [...new Set(values)];
  }

  inferStatus(relativePath, content) {
    const lower = `${relativePath}\n${content}`.toLowerCase();
    if (lower.includes('placeholder') || lower.includes('not implemented')) return 'PARTIAL';
    if (lower.includes('todo') || lower.includes('fixme') || lower.includes('stub')) return 'NEEDS_REVIEW';
    if (/test|spec|healthcheck/i.test(relativePath)) return 'SUPPORTING';
    return 'DISCOVERED';
  }

  buildComponent(filePath) {
    const stat = fs.statSync(filePath);
    const relativePath = path.relative(this.rootDir, filePath);
    const content = this.safeRead(filePath);
    const classes = this.extractClasses(content);
    const exportedSymbols = this.extractExports(content);
    const supportedActions = this.extractArray(content, 'supportedActions');
    const approvalRequiredActions = this.extractArray(content, 'approvalRequiredActions');
    const categories = this.classify(relativePath, content);

    const idSource = `${relativePath}|${classes.join(',')}|${exportedSymbols.join(',')}`;
    const componentId = `CMP_${this.hashText(idSource).slice(0, 16).toUpperCase()}`;

    return {
      componentId,
      name: classes[0] || exportedSymbols[0] || path.basename(filePath, path.extname(filePath)),
      relativePath,
      extension: path.extname(filePath).toLowerCase(),
      categories,
      primaryType: categories[0],
      status: this.inferStatus(relativePath, content),
      classes,
      exportedSymbols,
      supportedActions,
      approvalRequiredActions,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      contentHash: this.hashText(content),
      discoveredAt: this.now()
    };
  }

  loadPrevious() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
      return Array.isArray(parsed.components) ? parsed.components : [];
    } catch {
      return [];
    }
  }

  compare(previous, current) {
    const oldMap = new Map(previous.map(item => [item.componentId, item]));
    const newMap = new Map(current.map(item => [item.componentId, item]));

    const added = current.filter(item => !oldMap.has(item.componentId));
    const removed = previous.filter(item => !newMap.has(item.componentId));
    const changed = current.filter(item => {
      const old = oldMap.get(item.componentId);
      return old && old.contentHash !== item.contentHash;
    }).map(item => ({
      componentId: item.componentId,
      name: item.name,
      relativePath: item.relativePath,
      previousHash: oldMap.get(item.componentId).contentHash,
      currentHash: item.contentHash
    }));

    return { added, removed, changed, generatedAt: this.now() };
  }

  generateSummary(components) {
    const countByType = {};
    const countByStatus = {};
    let supportedActionCount = 0;

    for (const component of components) {
      countByType[component.primaryType] = (countByType[component.primaryType] || 0) + 1;
      countByStatus[component.status] = (countByStatus[component.status] || 0) + 1;
      supportedActionCount += component.supportedActions.length;
    }

    return {
      ok: true,
      service: this.service,
      version: this.version,
      rootDir: this.rootDir,
      componentCount: components.length,
      supportedActionCount,
      countByType,
      countByStatus,
      generatedAt: this.now()
    };
  }

  scan() {
    const previous = this.loadPrevious();
    const files = this.walk();
    const components = [];

    for (const filePath of files) {
      try {
        components.push(this.buildComponent(filePath));
      } catch {
        // A single unreadable file must not stop the registry build.
      }
    }

    components.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const changes = this.compare(previous, components);
    const summary = this.generateSummary(components);

    fs.writeFileSync(
      this.registryPath,
      JSON.stringify({
        ok: true,
        service: this.service,
        version: this.version,
        rootDir: this.rootDir,
        components,
        generatedAt: this.now()
      }, null, 2),
      'utf8'
    );

    fs.writeFileSync(this.summaryPath, JSON.stringify(summary, null, 2), 'utf8');
    fs.writeFileSync(this.changesPath, JSON.stringify(changes, null, 2), 'utf8');

    return { ...summary, changes };
  }

  healthCheck() {
    const filesExist = [this.registryPath, this.summaryPath, this.changesPath]
      .every(filePath => fs.existsSync(filePath));

    return {
      ok: filesExist,
      service: this.service,
      version: this.version,
      status: filesExist ? 'HEALTHY' : 'NOT_INITIALIZED',
      registryPath: this.registryPath,
      summaryPath: this.summaryPath,
      changesPath: this.changesPath,
      generatedAt: this.now()
    };
  }
}

module.exports = EnterpriseComponentRegistryService;
