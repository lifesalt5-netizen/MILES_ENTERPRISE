# EXEC_001 Operating Notes

EXEC_001 is the action bridge between the verified MILES COO runtime and real provider execution.

It intentionally separates:

- action normalization
- provider resolution
- dispatch
- verification
- retry
- audit/history

External provider write operations remain blocked until dedicated provider controllers and credential vault support are installed.
