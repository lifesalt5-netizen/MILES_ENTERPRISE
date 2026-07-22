"use strict";

const fs = require("fs");
const path = require("path");

const root = process.argv[2];

if (!root) {
    throw new Error("MILES root path is required.");
}

const bridgePath = path.join(
    root,
    "SERVICES",
    "BusinessOperationsBridgeService.js"
);

const revenuePath = path.join(
    root,
    "SERVICES",
    "RevenueMissionSourceService.js"
);

function read(filePath) {
    return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

function write(filePath, content) {
    fs.writeFileSync(filePath, content, "utf8");
}

function newlineOf(content) {
    return content.includes("\r\n") ? "\r\n" : "\n";
}

function addImport(content) {
    const existing =
        /(?:const|let|var)\s+ProviderRegistry\s*=\s*require\s*\(\s*["']\.\/ProviderRegistry["']\s*\)\s*;?/;

    if (existing.test(content)) {
        return {
            content,
            changed: false
        };
    }

    const newline = newlineOf(content);
    const importLine =
        'const ProviderRegistry = require("./ProviderRegistry");';

    const requireMatches = Array.from(
        content.matchAll(
            /^(?:const|let|var)\s+[^\r\n]+?=\s*require\s*\([^\r\n]+\)\s*;?[ \t]*$/gm
        )
    );

    if (requireMatches.length > 0) {
        const last = requireMatches[requireMatches.length - 1];
        const index = last.index + last[0].length;

        return {
            content:
                content.slice(0, index) +
                newline +
                importLine +
                content.slice(index),
            changed: true
        };
    }

    const strict = /^["']use strict["'];?[ \t]*$/m.exec(content);

    if (strict) {
        const index = strict.index + strict[0].length;

        return {
            content:
                content.slice(0, index) +
                newline +
                newline +
                importLine +
                content.slice(index),
            changed: true
        };
    }

    return {
        content:
            importLine +
            newline +
            newline +
            content,
        changed: true
    };
}

function findClosingBrace(content, openIndex) {
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = openIndex; index < content.length; index += 1) {
        const char = content[index];
        const next = content[index + 1];

        if (lineComment) {
            if (char === "\n") {
                lineComment = false;
            }
            continue;
        }

        if (blockComment) {
            if (char === "*" && next === "/") {
                blockComment = false;
                index += 1;
            }
            continue;
        }

        if (quote) {
            if (escaped) {
                escaped = false;
            }
            else if (char === "\\") {
                escaped = true;
            }
            else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === "/" && next === "/") {
            lineComment = true;
            index += 1;
            continue;
        }

        if (char === "/" && next === "*") {
            blockComment = true;
            index += 1;
            continue;
        }

        if (char === "'" || char === '"' || char === "`") {
            quote = char;
            continue;
        }

        if (char === "{") {
            depth += 1;
        }
        else if (char === "}") {
            depth -= 1;

            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

function replaceResolver(content) {
    const signature =
        /(^[ \t]*)(?:async\s+)?resolveProvider\s*\(\s*operation\s*=\s*\{\s*\}\s*\)\s*\{/m;

    const match = signature.exec(content);

    if (!match) {
        return {
            content,
            changed: false,
            found: false
        };
    }

    const openIndex =
        match.index + match[0].lastIndexOf("{");

    const closeIndex =
        findClosingBrace(content, openIndex);

    if (closeIndex < 0) {
        throw new Error(
            "Could not find resolveProvider closing brace."
        );
    }

    const newline = newlineOf(content);
    const indent = match[1];

    const replacement = [
        `${indent}resolveProvider(operation = {}) {`,
        `${indent}    const provider = ProviderRegistry.resolve(operation);`,
        `${indent}    return provider ? provider.id : "MILES";`,
        `${indent}}`
    ].join(newline);

    return {
        content:
            content.slice(0, match.index) +
            replacement +
            content.slice(closeIndex + 1),
        changed: true,
        found: true
    };
}

function addMetadataDefaults(content) {
    if (
        /const\s+providerInfo\s*=\s*ProviderRegistry\.get\s*\(/.test(
            content
        )
    ) {
        return {
            content,
            changed: false
        };
    }

    const newline = newlineOf(content);

    const pattern =
        /(^[ \t]*const\s+provider\s*=\s*[\s\S]*?;)(\r?\n)([ \t]*const\s+connector\s*=)/m;

    const match = pattern.exec(content);

    if (!match) {
        return {
            content,
            changed: false
        };
    }

    const indentMatch = /^[ \t]*/.exec(match[1]);
    const indent = indentMatch ? indentMatch[0] : "";

    let updated =
        content.slice(0, match.index) +
        match[1] +
        newline +
        newline +
        `${indent}const providerInfo = ProviderRegistry.get(provider) || {};` +
        newline +
        newline +
        match[3] +
        content.slice(match.index + match[0].length);

    updated = updated.replace(
        /(const\s+connector\s*=\s*[\s\S]*?planned\.connector\s*\|\|\s*)provider(\s*;)/m,
        `$1providerInfo.connector ||${newline}${indent}    provider$2`
    );

    updated = updated.replace(
        /(const\s+system\s*=\s*[\s\S]*?planned\.system\s*\|\|\s*)provider(\s*;)/m,
        `$1providerInfo.connector ||${newline}${indent}    provider$2`
    );

    updated = updated.replace(
        /(const\s+department\s*=\s*[\s\S]*?planned\.department\s*\|\|\s*)provider(\s*;)/m,
        `$1providerInfo.department ||${newline}${indent}    provider$2`
    );

    return {
        content: updated,
        changed: updated !== content
    };
}

function patch(filePath, integrateMetadata) {
    let content = read(filePath);
    let changed = false;

    const importResult = addImport(content);
    content = importResult.content;
    changed = changed || importResult.changed;

    const resolverResult = replaceResolver(content);
    content = resolverResult.content;
    changed = changed || resolverResult.changed;

    if (integrateMetadata) {
        const metadataResult = addMetadataDefaults(content);
        content = metadataResult.content;
        changed = changed || metadataResult.changed;
    }

    if (changed) {
        write(filePath, content);
    }

    console.log(
        `[PATCH] ${path.basename(filePath)} ` +
        `changed=${changed} ` +
        `resolverFound=${resolverResult.found}`
    );
}

patch(bridgePath, true);
patch(revenuePath, false);
