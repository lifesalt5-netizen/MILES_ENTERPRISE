# Compatibility

EXEC_009 does not change BUILD_031 through EXEC_008. It registers a new provider named `NAMECHEAP` and exposes capabilities to the existing Unified Action Engine.

## Integration Contract

Input: ProviderAction
Output: ProviderResult

All writes are governance-checked and blocked unless controlled writes are enabled and the action is not approval-restricted.
