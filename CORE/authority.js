function isProtectedOutboundDomain(text) {
  return /pathways2gc\.com/i.test(text || '') && /outbound|instantly|campaign|send/i.test(text || '');
}

function requiresApproval(system, action) {
  const combined = `${system} ${action}`;
  if (isProtectedOutboundDomain(combined)) return { allowed: false, approval: 'Never allowed' };
  if (/publish/i.test(combined)) return { allowed: false, approval: 'Kevin approval required' };
  if (/delete|spend|buy domain|cancel domain|dns/i.test(combined)) return { allowed: false, approval: 'Kevin approval required' };
  return { allowed: true, approval: 'No approval required unless protected asset involved' };
}

module.exports = { requiresApproval, isProtectedOutboundDomain };
