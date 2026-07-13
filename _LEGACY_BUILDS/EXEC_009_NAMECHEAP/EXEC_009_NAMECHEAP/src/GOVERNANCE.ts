// EXEC_009_NAMECHEAP — MILES OS provider module
// Controlled-write compatible. Secrets must come from environment/vault.

const APPROVAL_REQUIRED = new Set([
  'PurchaseDomain','TransferDomain','DeleteDNSRecord','ChangeNameservers','DisableMailRouting'
]);

const WRITE_CAPABILITIES = new Set(['UpdateDNS','ApplySPF','ApplyDKIM','ApplyDMARC','ApplyMX']);

export function requiresApproval(capability: string, controlledWrites: boolean): boolean {
  if (APPROVAL_REQUIRED.has(capability)) return true;
  if (WRITE_CAPABILITIES.has(capability) && !controlledWrites) return true;
  return false;
}
