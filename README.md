# Ship & Fleet CMMS

Offline-first computerized maintenance management for a navy fleet. Every ship (and, where needed, workshop or command) runs its own complete installation — one Node.js process and one SQLite file — and keeps working with no internet, including approvals. Installations exchange changes with a central hub over the network or by signed USB file.

**Start here: [Architecture in diagrams](ARCHITECTURE_DIAGRAMS.md)** — fleet topology, inside an installation, modules, request flow, synchronization, maintenance workflow, data model and deployment options.

## Documents

| Document | What it covers |
|---|---|
| [ARCHITECTURE_DIAGRAMS.md](ARCHITECTURE_DIAGRAMS.md) | Picture-first overview for newcomers |
| [PROJECT_SPEC.md](PROJECT_SPEC.md) | Requirements, release scope, glossary |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack, layering, request flow, migrations |
| [MODULE_MAP.md](MODULE_MAP.md) | Modules, dependencies, public surfaces |
| [SYNC_RULES.md](SYNC_RULES.md) | Record classes, ownership, sync protocol, offline authority |
| [DATA_DICTIONARY.md](DATA_DICTIONARY.md) | Tables per module |
| [CONTRACTS.md](CONTRACTS.md) | Shared shapes and API conventions |
| [DECISIONS.md](DECISIONS.md) | Design decisions and their reasons |
| [OPERATIONS.md](OPERATIONS.md) | Install, run, back up, restore, upgrade, join a ship |
| [USER_GUIDE.md](USER_GUIDE.md) | Using the screens |
| [BUILD_STATUS.md](BUILD_STATUS.md) | What is built, what is open |

## Quick start (development)

Requires Node.js 22.23.4 or a later 22.x.

```bash
npm ci
npm run web:install
npm run init-installation -- --kind hub --code HQ --name "Fleet HQ"
npm run seed:demo-org
CMMS_DEV_AUTH=1 npm run dev     # API on :8080
npm run web:dev                 # UI on :5173
```

Checks: `npm run verify` (server) and `npm run verify:web` (web). Production install: [OPERATIONS.md](OPERATIONS.md).
