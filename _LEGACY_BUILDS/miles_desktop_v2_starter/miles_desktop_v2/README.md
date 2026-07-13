# MILES Desktop v2

MILES Desktop is the single daily application for Kevin to operate Pathways 2 Government Contracting through MILES, the Digital COO.

## What is included

- Desktop Shell
- Runtime Host
- Executive Chat
- CEO Dashboard
- Worker Dashboard
- Engineering Dashboard placeholder
- Task Dashboard
- Notification Center
- Approval Queue
- Config and governance rules
- Logging
- Windows launch-at-login hook
- Runtime start/stop/restart controls

## Install and run

```powershell
cd .\miles_desktop_v2
npm install
npm start
```

## Test

```powershell
npm test
```

## Backup

```powershell
npm run backup
```

## Integration point

Replace the mock RuntimeHost behavior in:

```text
src/runtime/runtimeHost.js
```

with calls into the existing MILES Runtime Controller, Supervisor, Connector Manager, Task Queue, Planner, Workflow Engine, Workforce Engine, Execution Engine, Discovery Engine, Engineering Manager, Browser Manager, Executive Memory, Recovery Intelligence, and Decision Engine.

The UI already expects every subsystem to expose:

```text
status()
healthCheck()
execute()
```
