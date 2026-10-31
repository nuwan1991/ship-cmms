# Ship & Fleet CMMS — Architecture in Diagrams

A picture-first tour of the system for people new to it. The diagrams render directly on GitHub (Mermaid). For the full rules behind each picture see [ARCHITECTURE.md](ARCHITECTURE.md), [MODULE_MAP.md](MODULE_MAP.md), [SYNC_RULES.md](SYNC_RULES.md) and [DATA_DICTIONARY.md](DATA_DICTIONARY.md).

**In one sentence:** every ship (and, where needed, workshop or command) runs its own complete copy of the CMMS on a local computer, works fully offline, and exchanges changes with a central hub at headquarters over the network or by USB file when a link is available.

---

## 1. The fleet: hub and spoke

```mermaid
flowchart TB
    subgraph HQ["Fleet HQ — HUB installation"]
        HUB["CMMS hub<br/>reference data · number ranges<br/>sync relay · user provisioning"]
        HUBDB[("SQLite<br/>hub database")]
        HUB --- HUBDB
        HQPC["HQ staff<br/>web browsers"] --> HUB
        CMDCLIENT["Command / workshop users<br/>with a permanent link<br/>(clients of the hub, no replica)"] --> HUB
    end

    subgraph SHIP1["Ship A — SHIP installation"]
        S1["CMMS ship server"]
        S1DB[("SQLite<br/>ship database")]
        S1 --- S1DB
        S1PC["Department PCs<br/>on the ship LAN"] --> S1
    end

    subgraph SHIP2["Ship B — SHIP installation (no link)"]
        S2["CMMS ship server"]
        S2DB[("SQLite<br/>ship database")]
        S2 --- S2DB
        S2PC["Department PCs"] --> S2
    end

    subgraph WS["Workshop — WORKSHOP installation"]
        W1["CMMS workshop server"]
        W1DB[("SQLite")]
        W1 --- W1DB
    end

    S1 <-->|"HTTPS sync<br/>hello · push · pull"| HUB
    S2 <-.->|"signed bundle file<br/>carried on USB"| HUB
    W1 <-->|"HTTPS sync"| HUB
```

- Replicas never talk to each other directly — the hub relays everything.
- The network link and the USB file carry the **same signed change envelope**, so a ship with no link at all still exchanges data.
- Each installation is **one Node.js process + one SQLite file**. Nothing runs in the cloud, nothing needs internet.

---

## 2. Inside one installation

```mermaid
flowchart LR
    B["Web browser<br/>React SPA"] -->|"HTTP /api/v1/..."| F

    subgraph NODE["One Node.js process (src/main.ts)"]
        F["Fastify HTTP server<br/>+ static web files"]
        AUTH["M02 Identity<br/>sign-in · sessions · Authorizer"]
        MODS["Business modules<br/>M01 · M03 · M04 · M05 · M06 · M07"]
        SVC["Support modules<br/>M10 Sync · M11 Excel · M13 Reports · M14 Operations"]
        K["Platform kernel (src/platform)<br/>ids · records write path · audit · change log<br/>number ranges · events · migrations · ports"]
        SCHED["Backup scheduler"]

        F --> AUTH --> MODS
        F --> SVC
        MODS --> K
        SVC --> K
        SCHED --> SVC
    end

    K --> DB[("SQLite file<br/>WAL, synchronous=FULL")]
    SVC -->|"backups"| BK[("data/backups")]
    SVC <-->|"sync"| HUB["Hub"]
```

| Layer | Where | Technology |
|---|---|---|
| Web UI | `web/` | React 19, React Router, Vite — bundled, no CDN |
| HTTP / API | `src/app.ts`, each module's `routes.ts` | Fastify 5, Zod 4 validation |
| Business logic | `src/modules/mNN-*/service.ts` | TypeScript (strict, ESM) on Node.js 22 |
| Kernel | `src/platform/` | shared by all modules, imports none of them |
| Storage | one SQLite file per installation | better-sqlite3, forward-only SQL migrations |

---

## 3. Modules and how they depend on each other

Arrows point from a module to the module it uses. Grey boxes are planned for Release 2.

```mermaid
flowchart BT
    M00["M00 Platform kernel"]

    M01["M01 Organization<br/>fleet · commands · ships · locations"]
    M02["M02 Identity<br/>users · roles · approvals · offline authority"]
    M03["M03 Assets<br/>positions · equipment · classifications"]
    M04["M04 QR labels & surveys"]
    M05["M05 Work<br/>defects · repair cases · work orders"]
    M06["M06 Planned maintenance<br/>plans · meters · calibration"]
    M07["M07 Stores<br/>parts · stock · transfers"]
    M10["M10 Sync<br/>provisioning · push/pull · conflicts"]
    M11["M11 Excel import/export"]
    M13["M13 Reports & notifications"]
    M14["M14 Operations<br/>backup · restore · health"]

    M08["M08 Workshops & skills"]:::r2
    M09["M09 Coordinated planning"]:::r2
    M12["M12 Monitoring & alarms"]:::r2

    M02 --> M01
    M03 --> M01
    M04 --> M01
    M04 --> M03
    M05 --> M01
    M05 --> M03
    M06 --> M01
    M06 --> M03
    M06 --> M05
    M07 --> M01
    M07 --> M03
    M07 --> M05
    M08 -.-> M01
    M08 -.-> M02
    M09 -.-> M05
    M09 -.-> M06
    M09 -.-> M07
    M09 -.-> M08
    M12 -.-> M03

    M10 -->|"entity registry"| M00
    M11 -->|"import/export port"| M00
    M13 -->|"reads *_v_* views only"| M00
    M14 --> M00
    M01 --> M00

    classDef r2 fill:#eee,stroke:#999,stroke-dasharray: 4 3,color:#666;
```

Rules that keep the modules independent (checked automatically by `npm run check:boundaries`):

1. A module imports only the platform, itself, and the public `index.ts` of modules it declares as dependencies.
2. Each module owns its own tables (prefix `org_`, `ast_`, `wrk_`, …). Others read them only through public functions or published `<prefix>_v_*` views.
3. Where a dependency would point the wrong way, modules talk through **ports** registered at start-up (Authorizer, ApprovalPort, ImportExportPort, entity registry, event bus).

---

## 4. What happens on every change (request flow)

```mermaid
sequenceDiagram
    autonumber
    actor U as User (browser)
    participant F as Fastify route
    participant A as Authorizer (M02)
    participant S as Module service
    participant R as platform/records.ts
    participant DB as SQLite

    U->>F: PATCH /api/v1/work/work-orders/:id { expectedVersion }
    F->>F: correlation id, validate body (Zod)
    F->>A: check(permission, scope)
    A-->>F: allowed / provisional / denied
    F->>S: update(...)
    S->>S: business and gate checks
    S->>R: write(record)
    rect rgb(235, 245, 255)
    note over R,DB: one database transaction
    R->>DB: ownership + version check
    R->>DB: write row (version + 1)
    R->>DB: append audit event
    R->>DB: append to sys_change_log (for sync)
    end
    R-->>S: new version
    S-->>F: result
    F-->>U: 200 + new version
```

Every write to synchronized data goes through this one path, so audit and sync can never be forgotten.

---

## 5. Synchronization

### 5.1 One sync session

```mermaid
sequenceDiagram
    autonumber
    participant SH as Ship installation
    participant HUB as Hub

    SH->>HUB: hello (installation id, Ed25519 signature,<br/>schema versions, push & pull cursors)
    HUB-->>SH: last change accepted from this ship<br/>(detects a restored hub)
    loop batches of ≤ 500 changes
        SH->>HUB: push local changes above cursor
        HUB->>HUB: verify signature, ownership, schema, dependencies
        HUB-->>SH: per change: accepted · duplicate · rejected · quarantined
    end
    loop batches
        SH->>HUB: pull above cursor
        HUB-->>SH: changes for this ship's subscription (parents first)
        SH->>SH: apply in one transaction, rebuild derived tables
    end
    note over SH,HUB: Cursors move only after commit — every step can be repeated safely.<br/>A USB bundle file is exactly one push + pull.
```

### 5.2 Who may change what

```mermaid
flowchart LR
    subgraph H["hub_reference"]
        h1["ships, commands, roles,<br/>parts catalogue, number ranges"]
    end
    subgraph O["owner_mutable"]
        o1["assets, positions, defects,<br/>work orders, plans, locations"]
    end
    subgraph E["event (append-only)"]
        e1["audit, approvals, stock moves,<br/>meter readings, labour"]
    end
    subgraph D["derived / local"]
        d1["current stock, asset state,<br/>sessions, settings"]
    end

    H -->|"hub writes → all replicas<br/>hub always wins"| R1(("replicas"))
    O -->|"only the owner installation writes<br/>higher version wins, forks quarantined"| R1
    E -->|"anyone appends, nobody edits<br/>union by id"| R1
    D -.->|"never synced, rebuilt locally"| R1
```

Conflicts are rare by design: one writer per record, append-only events, and every number (tags, work-order numbers) comes from a range the hub granted in advance so ships can number offline.

---

## 6. The maintenance workflow

```mermaid
flowchart LR
    subgraph AST["M03 Assets"]
        POS["Position<br/>(place in ship's tree)"]
        ASSET["Asset<br/>(physical item, permanent tag)"]
        ASSET -->|"installed in"| POS
    end

    QR["M04 QR label<br/>& compartment survey"] -->|"identifies / registers"| ASSET

    DEF["Defect<br/>reported by crew"] --> CASE["Repair case"]
    CASE --> WO["Work order"]
    PM["M06 PM plan<br/>calendar or running hours"] -->|"generates when due"| WO
    METER["Meter readings"] --> PM

    WO -->|"approve gate"| APPR{{"M02 approval"}}
    APPR --> JC["Job card<br/>labour · findings · tests"]
    STK["M07 Stores<br/>issue parts"] -->|"stock events"| WO
    JC --> ACC{{"acceptance gate"}}
    ACC --> CLOSED["Closed /<br/>returned to service"]

    DEF -.->|"against"| ASSET
    WO -.->|"against"| ASSET

    CLOSED --> RPT["M13 Reports<br/>backlog · due · recurring faults"]
```

- **Position ≠ asset**: the ship's functional tree (system → equipment group → equipment → component) stays; physical assets are installed, removed and transferred over time but keep their permanent tag.
- Approvals still work offline under an **authority lease** (30 days by default). After it expires, reviews and approvals become *pending confirmation* until the next hub sync.

---

## 7. Core data at a glance

```mermaid
erDiagram
    FLEET ||--o{ COMMAND : has
    FLEET ||--o{ SHIP : has
    SHIP ||--o{ SHIP_COMMAND_ASSIGNMENT : "attached over time"
    COMMAND ||--o{ SHIP_COMMAND_ASSIGNMENT : receives
    SHIP ||--o{ LOCATION : "compartments"
    SHIP ||--o{ POSITION : "functional tree"
    POSITION ||--o{ POSITION : "parent of"
    CLASSIFICATION ||--o{ POSITION : classifies
    CLASSIFICATION ||--o{ ASSET : classifies
    ASSET ||--o{ ASSET_MOVEMENT : "install / remove / custody"
    POSITION ||--o{ ASSET_MOVEMENT : "at"
    ASSET ||--o{ DEFECT : "reported on"
    DEFECT }o--|| REPAIR_CASE : "grouped into"
    REPAIR_CASE ||--o{ WORK_ORDER : "executed by"
    PM_PLAN ||--o{ WORK_ORDER : generates
    WORK_ORDER ||--o{ JOB_CARD : has
    WORK_ORDER ||--o{ STOCK_TRANSACTION : "parts issued"
    PART ||--o{ STOCK_TRANSACTION : moves
    USER ||--o{ ROLE_ASSIGNMENT : "scoped, dated"
    USER ||--o{ APPROVAL : decides
```

---

## 8. Deployment options

```mermaid
flowchart TB
    subgraph A["Option A — normal"]
        direction LR
        HQM["HQ computer<br/>hub on :8080"] <-->|"network"| SHM["Ship computer<br/>ship on :8080"]
    end
    subgraph B["Option B — one computer (testing / training)"]
        direction LR
        F1["cmms-fleet folder<br/>hub on :8080"] <-->|"localhost"| F2["cmms-ship folder<br/>ship on :8081"]
    end
    subgraph C["Option C — offline machine"]
        direction LR
        ONLINE["Machine with internet<br/>npm ci · build"] -->|"copy folder on USB"| OFF["Machine that never has internet"]
    end
```

Install, backup, restore and upgrade steps: [OPERATIONS.md](OPERATIONS.md). Everyday use: [USER_GUIDE.md](USER_GUIDE.md).

---

## Release status

| Release | Modules | Status |
|---|---|---|
| R1 — Disconnected core | M00–M07, M10, M11, M13, M14 | **done** |
| R2 — Coordination | M08 workshops, M09 planning, M12 monitoring, readiness & cost reports | planned |
| R3 — Integration | read-only PLC connectors, notifications beyond the app | planned |

Detail per module: [BUILD_STATUS.md](BUILD_STATUS.md).
