"use strict";

const fs = require("fs");
const path = require("path");

const root = process.argv[2];
if (!root) throw new Error("MILES root path is required.");

const bridgePath = path.join(root, "SERVICES", "BusinessOperationsBridgeService.js");
const revenuePath = path.join(root, "SERVICES", "RevenueMissionSourceService.js");

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}

function write(file, content) {
  fs.writeFileSync(file, content, "utf8");
}

function newlineOf(content) {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function addImport(content) {
  const importPattern =
    /(?:const|let|var)\s+ProviderRegistry\s*=\s*require\s*\(\s*["']\.\/ProviderRegistry["']\s*\)\s*;?/;

  if (importPattern.test(content)) return { content, changed: false };

  const nl = newlineOf(content);
  const line = 'const ProviderRegistry = require("./ProviderRegistry");';

  const requires = [...content.matchAll(/^(?:const|let|var)\s+[^\r\n]+?=\s*require\s*\([^\r\n]+\)\s*;?[ \t]*$/gm)];
  if (requires.length) {
    const last = requires[requires.length - 1];
    const index = last.index + last[0].length;
    return {
      content: content.slice(0, index) + nl + line + content.slice(index),
      changed: true
    };
  }

  const strict = /^["']use strict["'];?[ \t]*$/m.exec(content);
  if (strict) {
    const index = strict.index + strict[0].length;
    return {
      content: content.slice(0, index) + nl + nl + line + content.slice(index),
      changed: true
    };
  }

  return { content: line + nl + nl + content, changed: true };
}

function findClosingBrace(content, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openIndex; i < content.length; i++) {
    const c = content[i];
    const n = content[i + 1];

    if (lineComment) {
      if (c === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === "*" && n === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = null;
      continue;
    }

    if (c === "/" && n === "/") { lineComment = true; i++; continue; }
    if (c === "/" && n === "*") { blockComment = true; i++; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }

    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function replaceResolver(content) {
  const sig = /(^[ \t]*)(?:async\s+)?resolveProvider\s*\(\s*operation\s*=\s*\{\s*\}\s*\)\s*\{/m;
  const match = sig.exec(content);
  if (!match) return { content, changed: false, found: false };

  const open = match.index + match[0].lastIndexOf("{");
  const close = findClosingBrace(content, open);
  if (close < 0) throw new Error("Could not find resolveProvider closing brace.");

  const nl = newlineOf(content);
  const i = match[1];
  const replacement = [
    `${i}resolveProvider(operation = {}) {`,
    `${i}    const provider = ProviderRegistry.resolve(operation);`,
    `${i}    return provider ? provider.id : "MILES";`,
    `${i}}`
  ].join(nl);

  return {
    content: content.slice(0, match.index) + replacement + content.slice(close + 1),
    changed: true,
    found: true
  };
}

function addMetadataDefaults(content) {
  if (/const\s+providerInfo\s*=\s*ProviderRegistry\.get\s*\(/.test(content)) {
    return { content, changed: false };
  }

  const nl = newlineOf(content);
  const pattern = /(^[ \t]*const\s+provider\s*=\s*[\s\S]*?;)(\r?\n)([ \t]*const\s+connector\s*=)/m;
  const match = pattern.exec(content);
  if (!match) return { content, changed: false };

  const indent = (/^[ \t]*/.exec(match[1]) || [""])[0];
  let updated =
    content.slice(0, match.index) +
    match[1] + nl + nl +
    `${indent}const providerInfo = ProviderRegistry.get(provider) || {};` + nl + nl +
    match[3] +
    content.slice(match.index + match[0].length);

  updated = updated.replace(
    /(const\s+connector\s*=\s*[\s\S]*?planned\.connector\s*\|\|\s*)provider(\s*;)/m,
    `$1providerInfo.connector ||${nl}${indent}    provider$2`
  );
  updated = updated.replace(
    /(const\s+system\s*=\s*[\s\S]*?planned\.system\s*\|\|\s*)provider(\s*;)/m,
    `$1providerInfo.connector ||${nl}${indent}    provider$2`
  );
  updated = updated.replace(
    /(const\s+department\s*=\s*[\s\S]*?planned\.department\s*\|\|\s*)provider(\s*;)/m,
    `$1providerInfo.department ||${nl}${indent}    provider$2`
  );

  return { content: updated, changed: updated !== content };
}

function patch(file, metadata) {
  let content = read(file);
  let changed = false;

  const imported = addImport(content);
  content = imported.content;
  changed ||= imported.changed;

  const resolved = replaceResolver(content);
  content = resolved.content;
  changed ||= resolved.changed;

  if (metadata) {
    const meta = addMetadataDefaults(content);
    content = meta.content;
    changed ||= meta.changed;
  }

  if (changed) write(file, content);

  console.log(`[PATCH] ${path.basename(file)} changed=${changed} resolverFound=${resolved.found}`);
}

patch(bridgePath, true);
patch(revenuePath, false);
