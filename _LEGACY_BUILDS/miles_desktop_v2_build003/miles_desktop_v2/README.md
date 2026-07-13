# MILES Desktop v2 — Build 003

This build turns the starter shell into a live local runtime application.

## Added

- Live MILES Runtime class
- Scheduler tick loop
- Supervisor status
- Connector Manager with health checks
- Worker Manager
- Task Queue
- Approval Queue
- Notification Center
- Executive Brain command routing
- Electron IPC bridge
- Live CEO dashboard panels
- Executive Chat command handling
- Smoke test
- Runtime logging under `data/logs/miles-runtime.log`

## Run

```powershell
npm install
npm start
```

## Test

```powershell
npm test
```

## First commands to try

- `Miles, what needs my attention?`
- `Show runtime status`
- `Show connector health`
- `Show task queue`

## Rule

This is now the MILES Desktop product. Future builds extend this runtime and UI directly.
