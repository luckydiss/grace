# GRACE MCP

`GRACE MCP` — встроенный MCP-сервер для framework `GRACE`.  
Сервер предоставляет внешний доступ к реальному runtime, а не дублирует orchestration logic в отдельном слое.

---

![MCP](https://img.shields.io/badge/MCP-Server-0A7CFF?style=flat-square)
![Transport](https://img.shields.io/badge/Transport-stdio%20%2B%20HTTP-0A7CFF?style=flat-square)
![Security](https://img.shields.io/badge/Security-Bearer%20Auth%20%2B%20Rate%20Limit-DC2626?style=flat-square)
![Protocol](https://img.shields.io/badge/Protocol-Versioned-111827?style=flat-square)

---

## Назначение

`GRACE MCP` используется как внешний control plane для:

- Codex
- MCP-compatible agent clients
- automation tooling
- операторских UI и dashboard surfaces
- internal engineering integrations

Сервер открывает наружу:

- lifecycle operations для workflow
- product bootstrap and validation
- state/history/blockers/trace observability
- artifact и report access
- agent evidence inspection
- legacy onboarding chain
- dry-run validation для legacy edit path

## Архитектурная Роль

`GRACE MCP` не является отдельным workflow engine.  
Все управляющие действия делегируются в основной runtime `GRACE`.

Схема работы:

1. MCP client вызывает tool или resource.
2. MCP handler вызывает соответствующий runtime surface внутри framework.
3. Framework materializes state changes, artifacts и evidence.
4. MCP возвращает structured result клиенту.

Из этого следуют два свойства:

- MCP surface остается thin и управляемым
- источник правды остается внутри `GRACE`, а не размазывается между несколькими API слоями

## Transport Modes

Поддерживаются два режима работы.

### 1. stdio

Предназначен для:

- локального запуска из Codex
- CLI-интеграций
- однопроцессных developer workflows

Команда:

```bash
npm run start
```

### 2. HTTP

Предназначен для:

- remote MCP clients
- agent gateways
- internal service-to-service integration
- операторских frontend surfaces

Команда:

```bash
npm run start:http
```

HTTP endpoint:

- `POST /mcp`

Unsupported methods:

- `GET /mcp` -> `405`
- `DELETE /mcp` -> `405`

## Repository Structure

```text
mcp/
  src/
    server.ts            MCP server definition
    http-server.ts       HTTP transport
    runtime/
      handlers.ts        tool and resource handlers
      config.ts          runtime configuration
  package.json
  tsconfig.json
  README.md
```

## Tool Surface

Ниже перечислен текущий публичный tool surface.

### Server

- `grace.server.info`

Назначение:

- server metadata
- protocol version
- auth requirement
- HTTP runtime constraints

### Products

- `grace.products.list`
- `grace.products.bootstrap`
- `grace.products.start_workflow`
- `grace.products.validate`

Назначение:

- discovery product workspaces
- bootstrap нового GRACE workspace
- bootstrap и доведение до approval boundary
- product validation

### Workflow

- `grace.workflow.state`
- `grace.workflow.history`
- `grace.workflow.blockers`
- `grace.workflow.trace`
- `grace.workflow.start`
- `grace.workflow.resume`
- `grace.workflow.approve`
- `grace.workflow.reject`
- `grace.workflow.validate`
- `grace.workflow.execution_proof`
- `grace.workflow.delivery_trace`

Назначение:

- чтение текущего workflow state
- чтение transition history
- чтение block reasons и issue pointers
- compact trace summary
- запуск и продолжение workflow
- approve/reject branches
- единый validation bundle
- execution-proof и delivery-trace validators

### Legacy

- `grace.legacy.bootstrap`
- `grace.legacy.validate`
- `grace.legacy.scan`
- `grace.legacy.infer_contracts`
- `grace.legacy.trace_seed`
- `grace.legacy.slice_propose`
- `grace.legacy.start_onboarding`
- `grace.legacy.edit_dry_run`

Назначение:

- overlay bootstrap для legacy repository
- overlay validation
- structural scan
- draft contract inference
- graph seed
- bounded slice proposal
- governed onboarding path
- dry-run validation для write path

### Agent / Evidence / Process

- `grace.agent.evidence`
- `grace.agent.trace`
- `grace.process.artifacts`
- `grace.autonomy.status`

Назначение:

- проверка полного evidence set по ролям
- чтение architect/coordinator/coder traces
- чтение handoff/CWO/branch spec/approval surfaces
- чтение failure-memory, forced-context и loop-guard status

### Artifact Read Surface

- `grace.report.read`
- `grace.artifact.read`

Назначение:

- чтение report files
- чтение arbitrary GRACE artifacts внутри product workspace

## Resource Surface

Поддерживаются MCP resources для read-oriented клиентов.

### Server

- `grace://server/info`

### Product Discovery

- `grace://products`

### Product State And Observability

- `grace://product/{productId}/state`
- `grace://product/{productId}/history`
- `grace://product/{productId}/trace`
- `grace://product/{productId}/blockers`
- `grace://product/{productId}/autonomy`
- `grace://product/{productId}/agents`
- `grace://product/{productId}/process`

### Legacy Resources

- `grace://product/{productId}/legacy/overlay`
- `grace://product/{productId}/legacy/source-map`
- `grace://product/{productId}/legacy/scan`
- `grace://product/{productId}/legacy/contracts`
- `grace://product/{productId}/legacy/graph`
- `grace://product/{productId}/legacy/slices`

## Resource Refresh Model

Mutation tools вызывают `resources/list_changed`, чтобы клиент мог обновлять:

- product list
- workflow state
- reports
- legacy onboarding artifacts

Это особенно важно для:

- bootstrap operations
- start/resume/approve/reject transitions
- legacy onboarding chain

## Input Contracts

Большинство mutating tools принимают:

- `repoRoot`
- `productRoot`
- `productId`

Legacy-specific tools также используют:

- `sourceRepoRoot`
- `sliceId`
- `requestedWritePaths`
- `writeModeAuthorized`

Workflow resume path использует:

- `approvalDecision`

## Output Format

Tool responses возвращаются как structured JSON payload внутри MCP text content.  
Resources отдаются как JSON content с соответствующим `uri`.

Это позволяет:

- использовать MCP client как thin orchestrator
- не парсить человеко-ориентированные строки
- стабильно автоматизировать проверки и переходы

## HTTP Runtime Contract

### Endpoint

- `POST /mcp`

### Response Headers

Сервер выставляет:

- `x-grace-mcp-protocol-version`
- `x-grace-mcp-server-version`
- `x-grace-mcp-server-name`

### Cache Behavior

Сервер выставляет:

- `cache-control: no-store`

### Error Model

HTTP layer использует JSON-RPC compatible error envelopes для:

- unauthorized requests
- protocol mismatch
- missing required version header
- oversized bodies
- rate limiting
- internal server error

## Security And Hardening

### Bearer Auth

Если задан `GRACE_MCP_AUTH_TOKEN`, сервер требует:

- `Authorization: Bearer <token>`

При отсутствии или несовпадении токена:

- ответ `401`
- header `WWW-Authenticate: Bearer realm="grace-mcp"`

### Protocol Version Enforcement

Сервер может требовать header:

- `x-grace-mcp-protocol-version`

Если включен strict mode и header отсутствует:

- ответ `428`

Если header задан, но версия не совпадает:

- ответ `400`

### Request Size Limit

Сервер контролирует:

- `content-length`
- maximum body size

При превышении лимита:

- ответ `413`

### Rate Limit

Используется простой in-memory rate limiter по IP.

При превышении лимита:

- ответ `429`

### Request Timeout

HTTP server поддерживает timeout на уровне transport layer.

## Environment Variables

### Supported Variables

- `PORT`
- `GRACE_MCP_AUTH_TOKEN`
- `GRACE_MCP_SERVER_VERSION`
- `GRACE_MCP_PROTOCOL_VERSION`
- `GRACE_MCP_REQUIRE_VERSION_HEADER`
- `GRACE_MCP_MAX_BODY_BYTES`
- `GRACE_MCP_RATE_LIMIT_PER_MINUTE`
- `GRACE_MCP_REQUEST_TIMEOUT_MS`

### Default Semantics

- `PORT` — default `3001`
- `GRACE_MCP_AUTH_TOKEN` — optional bearer auth token
- `GRACE_MCP_SERVER_VERSION` — server version override
- `GRACE_MCP_PROTOCOL_VERSION` — protocol version override
- `GRACE_MCP_REQUIRE_VERSION_HEADER` — `false` by default
- `GRACE_MCP_MAX_BODY_BYTES` — default `1048576`
- `GRACE_MCP_RATE_LIMIT_PER_MINUTE` — default `60`
- `GRACE_MCP_REQUEST_TIMEOUT_MS` — default `30000`

## Installation

Из корня framework:

```bash
npm --prefix mcp install
```

Из папки `mcp/`:

```bash
npm install
```

## Build

Из корня framework:

```bash
npm run mcp:build
```

Из папки `mcp/`:

```bash
npm run build
```

## Test

Из корня framework:

```bash
npm run mcp:test
```

Из папки `mcp/`:

```bash
npm run test
```

Тестовый набор покрывает:

- server bootstrap
- handlers
- stdio-safe imports
- HTTP app behavior
- auth checks
- protocol-version checks
- request size limits
- rate limiting
- workflow and legacy integration surface

## Run Commands

### From Framework Root

```bash
npm run mcp:start
npm run mcp:start:http
```

### From `mcp/`

```bash
npm run start
npm run start:http
```

## Production Deployment Profile

Рекомендуемая последовательность запуска:

1. установить root dependencies
2. установить `mcp` dependencies
3. собрать framework
4. собрать MCP
5. прогнать verify
6. задать security-related environment variables
7. запускать HTTP mode

Пример:

```bash
set GRACE_MCP_AUTH_TOKEN=replace-with-long-random-token
set GRACE_MCP_PROTOCOL_VERSION=2026-04-05
set GRACE_MCP_REQUIRE_VERSION_HEADER=true
set GRACE_MCP_MAX_BODY_BYTES=1048576
set GRACE_MCP_RATE_LIMIT_PER_MINUTE=60
set GRACE_MCP_REQUEST_TIMEOUT_MS=30000
npm run start:http
```

## Codex / MCP Client Usage

### stdio Registration

Пример запуска через локальный client:

```bash
npm run mcp:start
```

### HTTP Registration

После запуска HTTP mode endpoint будет доступен по адресу:

```text
http://127.0.0.1:3001/mcp
```

Если включен bearer auth, клиент должен передавать token.  
Если включено protocol enforcement, клиент должен передавать `x-grace-mcp-protocol-version`.

## Operational Notes

`GRACE MCP` не хранит отдельное состояние, независимое от framework runtime.  
Все операции выполняются поверх:

- framework product workspaces
- workflow artifacts
- runtime-generated evidence
- legacy overlay metadata

Это упрощает debugging, audit и rollback analysis.

## When To Use This Package

`GRACE MCP` подходит, если требуется:

- подключить `GRACE` к Codex или другому MCP client
- автоматизировать workflow lifecycle через tools
- читать state/history/trace как structured external interface
- работать с legacy onboarding без прямого доступа к внутренним CLI
- поднимать HTTP MCP surface для внутренней инфраструктуры

## Current Scope

Текущий baseline включает:

- stdio transport
- HTTP transport
- product lifecycle surface
- workflow lifecycle surface
- observability surface
- legacy onboarding surface
- artifact and report access
- auth, protocol versioning, rate limit и body limit

`GRACE MCP` следует использовать как официальный внешний интерфейс к runtime `GRACE`.
