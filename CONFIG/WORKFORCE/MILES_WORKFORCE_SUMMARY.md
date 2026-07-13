# MILES Workforce Registry v1.0

Kevin states objectives. MILES determines capabilities, assembles the workforce, executes or delegates, verifies results, and escalates only CEO-level decisions.

## Departments
- **Market Intelligence**: MARCUS, ADEN, OLIVIA
- **Sales**: ALEXIS, SOPHIA, ARIA
- **Capture**: CORA, JASON, JACKSON
- **Vehicle Strategy**: DANIEL, ISABEL, VICTORIA
- **Proposal**: KEITH
- **SLED**: CLAUDIA
- **Recompete Intelligence**: ALLISON
- **Eligibility & Past Performance**: NATALIE
- **Pricing**: DEREK

## Next Runtime Integration
1. Put `MILES_WORKFORCE_REGISTRY.json` in `CONFIG/`.
2. Add a WorkforceManager that loads this registry.
3. DecisionEngine requests capabilities, not worker names.
4. WorkforceManager returns the best worker/team.
5. MILES executes/delegates and returns one answer to Kevin.