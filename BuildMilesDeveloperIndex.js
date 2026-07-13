'use strict';

/*
  MILES Developer Intelligence System
  File: BuildMilesDeveloperIndex.js
  Version: 1.0.0

  Purpose:
  - Build a fast inventory of the active MILES source code.
  - Map files, imports, exports, classes, functions, capabilities and references.
  - Identify likely services, planners, queues, registries, connectors and duplicates.
  - Avoid node_modules, legacy builds, archives and generated runtime output.
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(
  process.env.MILES_ROOT ||
  process.cwd()
);

const OUTPUT_DIR = path.join(
  ROOT,
  'runtime',
  'developer_intelligence'
);

const INDEX_PATH = path.join(
  OUTPUT_DIR,
  'miles_code_index.json'
);

const SUMMARY_PATH = path.join(
  OUTPUT_DIR,
  'miles_code_index_summary.json'
);

const CSV_PATH = path.join(
  OUTPUT_DIR,
  'miles_code_index.csv'
);

const DUPLICATES_PATH = path.join(
  OUTPUT_DIR,
  'duplicate_candidates.json'
);

const CAPABILITIES_PATH = path.join(
  OUTPUT_DIR,
  'capability_candidates.json'
);

const DEPENDENCIES_PATH = path.join(
  OUTPUT_DIR,
  'dependency_edges.json'
);

const MARKDOWN_PATH = path.join(
  OUTPUT_DIR,
  'MILES_DEVELOPER_INTELLIGENCE.md'
);

const ALLOWED_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.py',
  '.ps1',
  '.json',
  '.sql'
]);

const EXCLUDED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.idea',
  '.vscode',
  '_LEGACY_BUILDS',
  '_REFERENCE',
  'REFERENCE',
  'legacy',
  'Legacy',
  'archive',
  'archives',
  'Archive',
  'Archives',
  'backup',
  'backups',
  'Backup',
  'Backups',
  'REPORTS',
  'reports',
  'coverage',
  'dist',
  'build',
  '.next',
  '.cache',
  '__pycache__',
  'output'
]);

const EXCLUDED_RELATIVE_PREFIXES = [
  'runtime\\enterprise_registry',
  'runtime\\developer_intelligence',
  'runtime\\runtime_registry',
  'runtime\\runtime_registry_v2'
];

function now() {
  return new Date().toISOString();
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, {
    recursive: true
  });
}

function normalizeRelative(filePath) {
  return path
    .relative(ROOT, filePath)
    .replace(/\//g, '\\');
}

function isExcludedPath(fullPath) {
  const relative = normalizeRelative(fullPath);
  const parts = relative.split('\\');

  if (
    parts.some(part =>
      EXCLUDED_DIRECTORY_NAMES.has(part)
    )
  ) {
    return true;
  }

  return EXCLUDED_RELATIVE_PREFIXES.some(prefix =>
    relative
      .toLowerCase()
      .startsWith(prefix.toLowerCase())
  );
}

function walk(directoryPath, files = []) {
  let entries;

  try {
    entries = fs.readdirSync(directoryPath, {
      withFileTypes: true
    });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(
      directoryPath,
      entry.name
    );

    if (isExcludedPath(fullPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path
      .extname(entry.name)
      .toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function safeRead(filePath) {
  try {
    const stats = fs.statSync(filePath);

    if (stats.size > 5 * 1024 * 1024) {
      return {
        text: '',
        skipped: true,
        reason: 'FILE_TOO_LARGE'
      };
    }

    return {
      text: fs.readFileSync(
        filePath,
        'utf8'
      ),
      skipped: false,
      reason: null
    };
  } catch (error) {
    return {
      text: '',
      skipped: true,
      reason: error.message
    };
  }
}

function unique(values) {
  return [
    ...new Set(
      values.filter(Boolean)
    )
  ];
}

function matchAll(text, regex, groupIndex = 1) {
  const values = [];
  let match;

  while (
    (match = regex.exec(text)) !== null
  ) {
    values.push(match[groupIndex]);
  }

  return unique(values);
}

function extractImports(text) {
  return unique([
    ...matchAll(
      text,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    ),
    ...matchAll(
      text,
      /from\s+['"]([^'"]+)['"]/g
    ),
    ...matchAll(
      text,
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    )
  ]);
}

function extractExports(text) {
  const exports = [];

  if (/module\.exports\s*=/.test(text)) {
    exports.push('module.exports');
  }

  exports.push(
    ...matchAll(
      text,
      /exports\.([A-Za-z0-9_$]+)\s*=/g
    )
  );

  exports.push(
    ...matchAll(
      text,
      /module\.exports\.([A-Za-z0-9_$]+)\s*=/g
    )
  );

  exports.push(
    ...matchAll(
      text,
      /export\s+(?:default\s+)?(?:class|function|const|let|var)\s+([A-Za-z0-9_$]+)/g
    )
  );

  return unique(exports);
}

function extractClasses(text) {
  return matchAll(
    text,
    /class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
  );
}

function extractFunctions(text) {
  return unique([
    ...matchAll(
      text,
      /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g
    ),
    ...matchAll(
      text,
      /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/g
    ),
    ...matchAll(
      text,
      /async\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g
    )
  ]);
}

function extractCapabilities(text) {
  const values = [];

  const capabilityArrayRegex =
    /capabilities\s*:\s*\[([\s\S]*?)\]/g;

  let arrayMatch;

  while (
    (arrayMatch =
      capabilityArrayRegex.exec(text)) !== null
  ) {
    values.push(
      ...matchAll(
        arrayMatch[1],
        /['"]([A-Z][A-Z0-9_.:-]{2,})['"]/g
      )
    );
  }

  values.push(
    ...matchAll(
      text,
      /['"]([A-Z][A-Z0-9_]{4,})['"]/g
    ).filter(value =>
      /(?:CREATE|READ|WRITE|UPDATE|DELETE|LIST|SYNC|UPLOAD|DOWNLOAD|EXECUTE|MANAGE|TRACK|RESOLVE|DISCOVER|PLAN|APPROVE|RECOMMEND|HEALTH|CAMPAIGN|LEAD|INBOX|ORION|GOOGLE|INSTANTLY|WEBSITE|QUEUE|MEMORY|EVENT|REGISTRY)/.test(
        value
      )
    )
  );

  return unique(values);
}

function detectModuleTypes(relativePath, text) {
  const source =
    `${relativePath}\n${text.slice(0, 5000)}`
      .toLowerCase();

  const types = [];

  const definitions = [
    ['CONNECTOR', /connector/],
    ['PLANNER', /planner|planningengine/],
    ['WORKER', /worker/],
    ['QUEUE', /queue|dispatcher/],
    ['REGISTRY', /registry/],
    ['SUPERVISOR', /supervisor/],
    ['MANAGER', /manager/],
    ['SERVICE', /service/],
    ['ENGINE', /engine/],
    ['ORCHESTRATOR', /orchestrator|digitalcoo|autonomouscoo/],
    ['EVENT_BUS', /eventbus|event_bus|event emitter/],
    ['MEMORY', /memory|timeline|history/],
    ['APPROVAL', /approval|authoritymatrix|requiresapproval/],
    ['RECOMMENDATION', /recommendation/],
    ['DASHBOARD', /dashboard|commandcenter/],
    ['POLICY', /policy|governance|guardrail/],
    ['SELF_HEALING', /self.?heal|auto.?heal|recovery|repair/],
    ['ORION', /\borion\b/],
    ['INSTANTLY', /instantly/],
    ['GOOGLE', /googleworkspace|googleapis|gmail|calendar/],
    ['WEBSITE', /website|playwright/],
    ['TEST', /test|spec/]
  ];

  for (const [type, pattern] of definitions) {
    if (pattern.test(source)) {
      types.push(type);
    }
  }

  return unique(types);
}

function classifyStatus(relativePath) {
  const normalized =
    relativePath.toLowerCase();

  if (
    normalized.includes('\\test') ||
    normalized.includes('_test.') ||
    normalized.includes('.test.') ||
    normalized.includes('.spec.')
  ) {
    return 'TEST';
  }

  if (
    normalized.includes('scaffold') ||
    normalized.includes('sample') ||
    normalized.includes('example')
  ) {
    return 'SCAFFOLD_OR_SAMPLE';
  }

  if (
    normalized.startsWith('services\\') ||
    normalized.startsWith('connectors\\') ||
    normalized.startsWith('core\\') ||
    normalized.startsWith('api\\') ||
    normalized.startsWith('workers\\') ||
    normalized.startsWith('enterprise\\') ||
    normalized.startsWith('governance\\')
  ) {
    return 'ACTIVE_CANDIDATE';
  }

  return 'UNCLASSIFIED';
}

function resolveLocalImport(
  sourceFile,
  importValue
) {
  if (
    !importValue.startsWith('.') &&
    !path.isAbsolute(importValue)
  ) {
    return null;
  }

  const sourceDirectory =
    path.dirname(sourceFile);

  const basePath =
    path.resolve(
      sourceDirectory,
      importValue
    );

  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.cjs`,
    `${basePath}.mjs`,
    `${basePath}.ts`,
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.cjs'),
    path.join(basePath, 'index.mjs'),
    path.join(basePath, 'index.ts')
  ];

  for (const candidate of candidates) {
    if (
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      return normalizeRelative(candidate);
    }
  }

  return null;
}

function escapeCsv(value) {
  const text =
    value === null ||
    value === undefined
      ? ''
      : String(value);

  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(records) {
  const columns = [
    'relativePath',
    'extension',
    'sizeBytes',
    'lastModified',
    'status',
    'moduleTypes',
    'classes',
    'functions',
    'exports',
    'imports',
    'localDependencyCount',
    'capabilities',
    'referenceCount',
    'skipped',
    'skipReason'
  ];

  const lines = [
    columns.map(escapeCsv).join(',')
  ];

  for (const record of records) {
    lines.push(
      columns.map(column => {
        const value = Array.isArray(
          record[column]
        )
          ? record[column].join(' | ')
          : record[column];

        return escapeCsv(value);
      }).join(',')
    );
  }

  fs.writeFileSync(
    CSV_PATH,
    lines.join('\n'),
    'utf8'
  );
}

function buildMarkdown(summary, duplicateGroups, typeCounts) {
  const duplicateRows =
    duplicateGroups
      .slice(0, 50)
      .map(group =>
        `| ${group.baseName} | ${group.count} | ${group.files.join('<br>')} |`
      )
      .join('\n') ||
    '| None | 0 | None |';

  const typeRows =
    Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) =>
        `| ${type} | ${count} |`
      )
      .join('\n');

  return `# MILES Developer Intelligence Index

Generated: ${summary.generatedAt}

## Executive Summary

| Metric | Result |
|---|---:|
| Files Indexed | ${summary.filesIndexed} |
| JavaScript Files | ${summary.javascriptFiles} |
| Active Candidates | ${summary.activeCandidates} |
| Tests | ${summary.testFiles} |
| Classes Found | ${summary.classesFound} |
| Functions Found | ${summary.functionsFound} |
| Imports Found | ${summary.importsFound} |
| Local Dependency Edges | ${summary.localDependencyEdges} |
| Capabilities Found | ${summary.capabilitiesFound} |
| Duplicate Name Groups | ${summary.duplicateNameGroups} |
| Unreferenced Active Candidates | ${summary.unreferencedActiveCandidates} |
| Files Skipped | ${summary.filesSkipped} |

## Module Type Counts

| Type | Count |
|---|---:|
${typeRows}

## Duplicate Candidates

| Base Name | Count | Files |
|---|---:|---|
${duplicateRows}

## Generated Files

- miles_code_index.json
- miles_code_index.csv
- miles_code_index_summary.json
- dependency_edges.json
- duplicate_candidates.json
- capability_candidates.json

## Interpretation

- Active candidate does not automatically mean the module is used at runtime.
- A reference count of zero does not prove dead code because MILES performs dynamic loading.
- Duplicate names are review candidates, not automatic deletion candidates.
- The index intentionally excludes node_modules, legacy builds, references, backups, reports and generated registries.
`;
}

function main() {
  ensureDirectory(OUTPUT_DIR);

  console.log(
    '============================================================'
  );
  console.log(
    'MILES DEVELOPER INTELLIGENCE INDEX'
  );
  console.log(
    '============================================================'
  );
  console.log(`Root: ${ROOT}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('');

  const discoveredFiles = walk(ROOT);

  console.log(
    `[MDIS] Source files discovered: ${discoveredFiles.length}`
  );

  const records = [];
  const recordByPath = new Map();
  const dependencyEdges = [];

  let processed = 0;

  for (const filePath of discoveredFiles) {
    processed += 1;

    if (
      processed % 250 === 0 ||
      processed === discoveredFiles.length
    ) {
      console.log(
        `[MDIS] Indexed ${processed}/${discoveredFiles.length}`
      );
    }

    const stats = fs.statSync(filePath);
    const relativePath =
      normalizeRelative(filePath);
    const readResult =
      safeRead(filePath);
    const text =
      readResult.text;

    const imports =
      readResult.skipped
        ? []
        : extractImports(text);

    const localDependencies =
      imports
        .map(importValue =>
          resolveLocalImport(
            filePath,
            importValue
          )
        )
        .filter(Boolean);

    const record = {
      absolutePath:
        filePath,
      relativePath,
      extension:
        path.extname(filePath)
          .toLowerCase(),
      baseName:
        path.basename(
          filePath,
          path.extname(filePath)
        ),
      sizeBytes:
        stats.size,
      lastModified:
        stats.mtime.toISOString(),
      status:
        classifyStatus(relativePath),
      moduleTypes:
        readResult.skipped
          ? []
          : detectModuleTypes(
              relativePath,
              text
            ),
      classes:
        readResult.skipped
          ? []
          : extractClasses(text),
      functions:
        readResult.skipped
          ? []
          : extractFunctions(text),
      exports:
        readResult.skipped
          ? []
          : extractExports(text),
      imports,
      localDependencies:
        unique(localDependencies),
      localDependencyCount:
        unique(localDependencies).length,
      capabilities:
        readResult.skipped
          ? []
          : extractCapabilities(text),
      referenceCount:
        0,
      referencedBy:
        [],
      skipped:
        readResult.skipped,
      skipReason:
        readResult.reason
    };

    records.push(record);
    recordByPath.set(
      relativePath.toLowerCase(),
      record
    );
  }

  for (const record of records) {
    for (
      const dependency
      of record.localDependencies
    ) {
      const target =
        recordByPath.get(
          dependency.toLowerCase()
        );

      dependencyEdges.push({
        source:
          record.relativePath,
        target:
          dependency,
        resolved:
          Boolean(target)
      });

      if (target) {
        target.referenceCount += 1;
        target.referencedBy.push(
          record.relativePath
        );
      }
    }
  }

  for (const record of records) {
    record.referencedBy =
      unique(record.referencedBy);
  }

  const duplicateMap = new Map();

  for (const record of records) {
    const key =
      record.baseName.toLowerCase();

    if (!duplicateMap.has(key)) {
      duplicateMap.set(key, []);
    }

    duplicateMap
      .get(key)
      .push(record.relativePath);
  }

  const duplicateGroups = [
    ...duplicateMap.entries()
  ]
    .filter(([, files]) =>
      files.length > 1
    )
    .map(([baseName, files]) => ({
      baseName,
      count:
        files.length,
      files
    }))
    .sort(
      (a, b) =>
        b.count - a.count
    );

  const capabilityMap =
    new Map();

  for (const record of records) {
    for (
      const capability
      of record.capabilities
    ) {
      if (!capabilityMap.has(capability)) {
        capabilityMap.set(
          capability,
          []
        );
      }

      capabilityMap
        .get(capability)
        .push(record.relativePath);
    }
  }

  const capabilityCandidates = [
    ...capabilityMap.entries()
  ]
    .map(([capability, providers]) => ({
      capability,
      providerCount:
        unique(providers).length,
      providers:
        unique(providers)
    }))
    .sort(
      (a, b) =>
        a.capability.localeCompare(
          b.capability
        )
    );

  const typeCounts = {};

  for (const record of records) {
    for (const type of record.moduleTypes) {
      typeCounts[type] =
        (typeCounts[type] || 0) + 1;
    }
  }

  const summary = {
    ok: true,
    service:
      'MILES_DEVELOPER_INTELLIGENCE',
    version:
      '1.0.0',
    root:
      ROOT,
    generatedAt:
      now(),
    filesIndexed:
      records.length,
    javascriptFiles:
      records.filter(record =>
        ['.js', '.cjs', '.mjs'].includes(
          record.extension
        )
      ).length,
    activeCandidates:
      records.filter(record =>
        record.status ===
        'ACTIVE_CANDIDATE'
      ).length,
    testFiles:
      records.filter(record =>
        record.status === 'TEST'
      ).length,
    classesFound:
      records.reduce(
        (total, record) =>
          total +
          record.classes.length,
        0
      ),
    functionsFound:
      records.reduce(
        (total, record) =>
          total +
          record.functions.length,
        0
      ),
    importsFound:
      records.reduce(
        (total, record) =>
          total +
          record.imports.length,
        0
      ),
    localDependencyEdges:
      dependencyEdges.filter(
        edge => edge.resolved
      ).length,
    capabilitiesFound:
      capabilityCandidates.length,
    duplicateNameGroups:
      duplicateGroups.length,
    unreferencedActiveCandidates:
      records.filter(record =>
        record.status ===
          'ACTIVE_CANDIDATE' &&
        record.referenceCount === 0
      ).length,
    filesSkipped:
      records.filter(record =>
        record.skipped
      ).length,
    typeCounts,
    outputDirectory:
      OUTPUT_DIR
  };

  fs.writeFileSync(
    INDEX_PATH,
    JSON.stringify(
      {
        summary,
        files:
          records
      },
      null,
      2
    ),
    'utf8'
  );

  fs.writeFileSync(
    SUMMARY_PATH,
    JSON.stringify(
      summary,
      null,
      2
    ),
    'utf8'
  );

  fs.writeFileSync(
    DUPLICATES_PATH,
    JSON.stringify(
      duplicateGroups,
      null,
      2
    ),
    'utf8'
  );

  fs.writeFileSync(
    CAPABILITIES_PATH,
    JSON.stringify(
      capabilityCandidates,
      null,
      2
    ),
    'utf8'
  );

  fs.writeFileSync(
    DEPENDENCIES_PATH,
    JSON.stringify(
      dependencyEdges,
      null,
      2
    ),
    'utf8'
  );

  writeCsv(records);

  fs.writeFileSync(
    MARKDOWN_PATH,
    buildMarkdown(
      summary,
      duplicateGroups,
      typeCounts
    ),
    'utf8'
  );

  console.log('');
  console.log(
    '============================================================'
  );
  console.log(
    'MILES DEVELOPER INTELLIGENCE COMPLETE'
  );
  console.log(
    '============================================================'
  );
  console.log(
    JSON.stringify(
      summary,
      null,
      2
    )
  );
  console.log('');
  console.log(
    `Report: ${MARKDOWN_PATH}`
  );
}

try {
  main();
} catch (error) {
  console.error(
    'MILES DEVELOPER INTELLIGENCE FAILED'
  );
  console.error(
    error.stack ||
    error.message
  );
  process.exitCode = 1;
}
