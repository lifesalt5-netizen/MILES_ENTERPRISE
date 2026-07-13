import { GovernanceDecision, MissionTask } from './MISSION_MODELS';

const approvalKeywords = [
  { token: 'pricing', category: 'PRICING' as const },
  { token: 'price', category: 'PRICING' as const },
  { token: 'contract', category: 'CONTRACTS' as const },
  { token: 'agreement', category: 'LEGAL' as const },
  { token: 'legal', category: 'LEGAL' as const },
  { token: 'hire', category: 'HIRING' as const },
  { token: 'contractor', category: 'HIRING' as const },
  { token: 'partnership', category: 'PARTNERSHIPS' as const },
  { token: 'partner', category: 'PARTNERSHIPS' as const },
  { token: 'strategic decision', category: 'STRATEGIC_DECISION' as const }
];

export function evaluateGovernance(name: string, capability: string, parameters: Record<string, unknown>): GovernanceDecision {
  const haystack = `${name} ${capability} ${JSON.stringify(parameters)}`.toLowerCase();
  const hit = approvalKeywords.find(rule => haystack.includes(rule.token));
  if (hit) {
    return { allowed: false, approvalRequired: true, reason: `Kevin approval required for ${hit.category}.`, approvalCategory: hit.category };
  }
  return { allowed: true, approvalRequired: false, reason: 'Within Miles autonomous execution authority.' };
}

export function taskRequiresEscalation(task: MissionTask): boolean {
  return task.governance.approvalRequired || !task.governance.allowed;
}
