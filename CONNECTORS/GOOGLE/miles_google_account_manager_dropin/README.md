# MILES Google Account Manager Drop-In

Adds account-specific Google token management for MILES OS.

## Install

Run from this extracted folder:

```powershell
.\install_google_account_manager.ps1
```

## Add Current Google Account

```powershell
cd D:\P2GC_Intelligence\MILES_OS
node CONNECTORS\GOOGLE\account_manager.js add
```

## List Accounts

```powershell
node CONNECTORS\GOOGLE\account_manager.js list
```

## Health Check

```powershell
node miles_google_accounts_health.js
```

## Workspace Snapshot

```powershell
node CONNECTORS\GOOGLE\workspace.js
```
