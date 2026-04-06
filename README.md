# GRACE

Production-grade framework для управляемой AI-разработки: workflow runtime, policy enforcement, контрактная адресация, bounded role execution, legacy onboarding и встроенный MCP-сервер.

---

![Node.js](https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-Workflow%20Runtime-121212?style=flat-square)
![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20HTTP-0A7CFF?style=flat-square)
![Traceability](https://img.shields.io/badge/Traceability-UC%2FMC%2FFC%2FBA-7C3AED?style=flat-square)
![Legacy](https://img.shields.io/badge/Legacy-Onboarding-059669?style=flat-square)

---

## Overview

`GRACE` предназначен для сценариев, в которых AI-агенты участвуют в разработке, но процесс должен оставаться управляемым, проверяемым и воспроизводимым.

Framework закрывает следующие задачи:

- оркестрация разработки через явные состояния workflow
- policy-as-code guards для критичных переходов
- адресация кода и документов через `UC / MC / FC / BA`
- bounded execution windows для ролей `architect`, `coordinator`, `coder`
- фиксированная evidence chain для каждого запуска роли
- legacy onboarding поверх существующего репозитория без немедленного переписывания исходников
- внешний control plane через встроенный `MCP`

`GRACE` ориентирован на production use, а не на prompt-only workflow discipline.

## Design Principles

### Workflow-First Execution

Изменения выполняются в рамках state machine.  
Переход определяется:

- текущим состоянием
- actor role
- policy
- required artifact refs
- разрешенным semantic scope

### Contract Addressability

Система использует контрактные идентификаторы:

- `UC` — use case
- `MC` — module contract
- `FC` — function contract
- `BA` — block anchor

Эта схема применяется как для greenfield кода, так и для legacy overlay.

### Evidence Before Promotion

Каждый важный шаг оставляет machine-readable evidence.  
Для role execution поддерживается комплект:

- `TaskPacket`
- `Invocation`
- `Execution`
- `SkillTrace`

Workflow не должен продвигаться дальше без обязательного evidence set.

### Policy Enforcement

Policy engine блокирует:

- недопустимые переходы
- несогласованные artifact refs
- неавторизованные source writes
- выход за пределы semantic slice
- write attempts вне editable whitelist

## Core Capabilities

### Workflow Runtime

Core runtime использует `LangGraph` как orchestration layer и дополняет его:

- typed workflow state
- transition engine
- interrupt/resume model
- approval and reject branches
- blocked state handling
- self-host validation hooks

### Role Execution

Role layer организован как bounded swarm runtime:

- `architect`
- `coordinator`
- `coder`

Запуск роли ограничен:

- workflow state window
- touched `FC`
- touched `BA`
- artifact set
- policy guards

### Validation Layer

Framework включает validators для:

- living documents
- transition evidence
- agent evidence completeness
- policy/schema consistency
- execution proof
- delivery trace
- schema validation

### Legacy Onboarding

Legacy onboarding формирует overlay workspace поверх существующего репозитория.

Поддерживаемая цепочка:

1. bootstrap overlay
2. scan repository
3. risk report
4. contract inference
5. trace seed
6. slice proposal
7. governed onboarding path
8. dry-run edit validation

### MCP Interface

Встроенный `MCP` предоставляет внешний доступ к runtime через:

- `stdio`
- streamable HTTP

Интерфейс поддерживает lifecycle operations, observability, artifact access и legacy onboarding.

## Architecture

### Repository Layout

```text
agents/                  role descriptors and shared skills
docs/grace/              canonical framework docs, templates, schemas, policies
mcp/                     embedded MCP server
src/                     core runtime and legacy onboarding
tools/                   CLI and operational utilities
package.json
README.md
```

### Source Areas

`src/` включает:

- `state/` — workflow state and transition engine
- `graph/` — LangGraph integration
- `policies/` — guard engine and policy contracts
- `validators/` — validation layer
- `executors/` — bounded role execution
- `artifacts/` — workflow-owned artifact emission
- `legacy/` — overlay bootstrap, scan, contract inference, trace seed, slice proposal
- `autonomy/` — failure memory, forced context, loop guard bridges
- `agents/` — descriptor loading, task packet and invocation logic

`agents/` включает:

- role descriptors
- shared protocols
- mode-specific skills

`tools/` включает:

- bootstrap and init tools
- validation tools
- verify runner
- schema tooling
- evidence tooling
- traceability tooling

## Documentation Model

`docs/grace/` разделен на две группы артефактов.

### Versioned Source Of Truth

- `RequirementsAnalysis.xml`
- `Technology.xml`
- `DevelopmentPlan.xml`
- `DevelopmentExecutionPlan.xml`
- `policies/`
- `schema/`
- `templates/`

### Runtime And Self-Host Artifacts

- `handoffs/`
- `cwo/`
- `reports/`
- `executions/`
- `state/`
- `approvals.log`

Runtime artifacts исключены из Git через `.gitignore`.  
В репозитории versioned остается framework source and canonical documentation.

## Workflow Model

### Standard Product Path

Типовой path для обычного продукта:

1. intake received
2. intake classified
3. blueprint drafting
4. blueprint review
5. blueprint approved
6. handoff proposed
7. approval boundary
8. coder execution
9. verification and traceability checks
10. release readiness

### Legacy Overlay Path

Типовой path для overlay:

1. bootstrap overlay
2. `LEGACY_DISCOVERY_PENDING`
3. `LEGACY_SCAN_READY`
4. `LEGACY_CONTRACTS_DRAFTED`
5. `LEGACY_GRAPH_READY`
6. `LEGACY_SLICE_READY`
7. dry-run validation
8. explicit write authorization
9. governed edit execution

## Swarm Runtime

### Roles

Поддерживаются три основные роли:

- `architect`
- `coordinator`
- `coder`

### Role Evidence

Для каждого запуска materialize-ятся:

- `TaskPacket`
- `Invocation`
- `Execution`
- `SkillTrace`

### Execution Constraints

Role execution ограничивается:

- разрешенным workflow state
- semantic slice
- artifact refs
- policy
- write authorization state

## Legacy Overlay Model

### Objective

Legacy path нужен для работы с существующим репозиторием без инвазивной миграции.

### Overlay Structure

Overlay workspace хранит:

- framework docs and policy
- workflow state
- scan artifacts
- risk report
- inferred contracts
- graph registry
- slice plan

Source repository остается отдельным root.

### Safe Edit Policy

Запись в source repo запрещена до выполнения всех условий:

- slice selected
- write mode authorized
- requested write paths declared
- requested write paths входят в whitelist

## MCP Server

`mcp/` содержит встроенный MCP server package.

### Supported Modes

- `stdio`
- HTTP `POST /mcp`

### MCP Responsibilities

- product bootstrap
- workflow lifecycle operations
- state/history/blockers/trace reads
- artifact and report reads
- agent evidence inspection
- legacy onboarding operations
- dry-run legacy edit validation

### HTTP Runtime Features

HTTP transport поддерживает:

- bearer auth
- protocol version headers
- request body limit
- in-memory rate limit
- request timeout
- method enforcement for `/mcp`

## Requirements

- Node.js `24+` for root package
- Node.js `20+` or newer for `mcp/`
- `npm`
- `git`

## Installation

### Root Package

```bash
npm install
```

### MCP Package

```bash
npm --prefix mcp install
```

## Build

### Core Build

```bash
npm run build
npm run build:tools
```

### MCP Build

```bash
npm run mcp:build
```

## Test

### Core Tests

```bash
npm test
```

### MCP Tests

```bash
npm run mcp:test
```

## Validation

### Framework And Product Validation

```bash
npm run validate
```

Validation covers:

- framework structure
- product structure
- canonical docs presence
- schema alignment
- self-host artifact consistency

### Full Verify Gate

```bash
npm run verify
```

`verify` executes:

- root build
- tools build
- root test suite
- MCP build
- MCP test suite
- framework validation
- product-root validation

## Runtime Commands

### Start Workflow

```bash
npm run workflow:start
```

### Resume Workflow

```bash
npm run workflow:resume
```

### MCP stdio

```bash
npm run mcp:start
```

### MCP HTTP

```bash
npm run mcp:start:http
```

## Operational Artifacts

Workflow runtime materializes:

- `docs/grace/state/WorkflowState.json`
- `docs/grace/state/TransitionLog.jsonl`
- execution artifacts
- reports
- approvals log updates

Эти артефакты являются runtime output и не должны рассматриваться как framework source.

## MCP Configuration

### Environment Variables

Supported HTTP variables:

- `PORT`
- `GRACE_MCP_AUTH_TOKEN`
- `GRACE_MCP_SERVER_VERSION`
- `GRACE_MCP_PROTOCOL_VERSION`
- `GRACE_MCP_REQUIRE_VERSION_HEADER`
- `GRACE_MCP_MAX_BODY_BYTES`
- `GRACE_MCP_RATE_LIMIT_PER_MINUTE`
- `GRACE_MCP_REQUEST_TIMEOUT_MS`

### Behavior

- `PORT` — HTTP port, default `3001`
- `GRACE_MCP_AUTH_TOKEN` — bearer token for `POST /mcp`
- `GRACE_MCP_SERVER_VERSION` — server version override
- `GRACE_MCP_PROTOCOL_VERSION` — protocol contract version
- `GRACE_MCP_REQUIRE_VERSION_HEADER` — enforce protocol version header
- `GRACE_MCP_MAX_BODY_BYTES` — request size limit
- `GRACE_MCP_RATE_LIMIT_PER_MINUTE` — in-memory rate limiting
- `GRACE_MCP_REQUEST_TIMEOUT_MS` — HTTP request timeout

### HTTP Headers

Server emits:

- `x-grace-mcp-protocol-version`
- `x-grace-mcp-server-version`
- `x-grace-mcp-server-name`

## Production Run Profile

Recommended production preparation sequence:

1. install dependencies
2. build root package
3. build tools
4. build MCP package
5. run full verify
6. start MCP HTTP with explicit environment configuration

Example:

```bash
set GRACE_MCP_AUTH_TOKEN=replace-with-long-random-token
set GRACE_MCP_PROTOCOL_VERSION=2026-04-05
set GRACE_MCP_REQUIRE_VERSION_HEADER=true
set GRACE_MCP_MAX_BODY_BYTES=1048576
set GRACE_MCP_RATE_LIMIT_PER_MINUTE=60
set GRACE_MCP_REQUEST_TIMEOUT_MS=30000
npm run mcp:start:http
```

## Security Model

`GRACE` reduces the following risks:

- uncontrolled workflow promotion
- out-of-scope edits
- source writes without authorization
- incomplete role evidence
- drift between state, policy and artifacts

Framework does not remove the need for engineering review, release discipline or operational controls.

## Repository Policy

The repository is organized as a framework-first codebase.  
Directory layout and documentation structure are aligned with runtime, policy and integration scenarios.

## Typical Use Cases

### New Product Governance

- bootstrap a new workspace
- fill living documents
- start workflow
- execute bounded slices

### Legacy Codebase Control Plane

- create overlay workspace
- scan existing repository
- infer draft contracts
- seed graph registry
- propose first safe slices
- authorize writes only through governed path

### External Agent Integration

- connect `mcp/`
- read state and blockers
- invoke workflow tools
- inspect role evidence and process trace

## Current Scope

Current baseline includes:

- governed workflow runtime
- bounded swarm execution
- policy enforcement
- legacy onboarding foundation
- MCP stdio transport
- MCP HTTP transport
- validation and verify gates

This repository can be used as a local engineering runtime and as an MCP-backed control plane for AI-assisted development.
