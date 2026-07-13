// ORION audit scaffold

export function auditOrionAction(entry: Record<string, unknown>) {
  return {
    provider: "ORION",
    ...entry,
    auditedAt: new Date().toISOString()
  };
}
