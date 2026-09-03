'use strict';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function asciiFold(value) {
  return clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function splitCamel(value) {
  return asciiFold(value).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function normalize(value) {
  return splitCamel(value)
    .replace(/&/g, ' AND ')
    .replace(/\+/g, ' AND ')
    .replace(/[’'`]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SUFFIXES = new Set([
  'LLC','INC','INCORPORATED','CORP','CORPORATION','COMPANY','CO',
  'LTD','LIMITED','LP','LLP','PLLC','PLC','PC','PA'
]);

function canonical(value) {
  const tokens = normalize(value).split(' ').filter(Boolean);
  let changed = true;
  while (tokens.length && changed) {
    changed = false;
    if (SUFFIXES.has(tokens[tokens.length - 1])) {
      tokens.pop();
      changed = true;
      continue;
    }
    for (let width = Math.min(4, tokens.length); width >= 2; width -= 1) {
      const tail = tokens.slice(-width);
      if (tail.every(token => token.length === 1) && SUFFIXES.has(tail.join(''))) {
        tokens.splice(tokens.length - width, width);
        changed = true;
        break;
      }
    }
  }
  return tokens.join(' ');
}

function compact(value) {
  return normalize(value).replace(/\s+/g, '');
}

function canonicalCompact(value) {
  return canonical(value).replace(/\s+/g, '');
}

function equivalent(a, b) {
  const left = canonicalCompact(a);
  const right = canonicalCompact(b);
  return Boolean(left && right && left === right);
}

module.exports = {
  clean,
  asciiFold,
  splitCamel,
  normalize,
  compact,
  canonical,
  canonicalCompact,
  equivalent,
  suffixes: SUFFIXES
};
