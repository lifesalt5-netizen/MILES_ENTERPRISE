export function nowIso(): string {
  return new Date().toISOString();
}

export function id(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}_${ts}_${rand}`;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
