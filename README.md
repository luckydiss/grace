# GRACE

Production-ready framework для управляемой разработки с ИИ: workflow state machine, policy guards, контрактная трассировка, bounded swarm execution и встроенный `MCP`-сервер для внешних агентов и клиентов.

---

![Node.js](https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-Workflow%20Runtime-121212?style=flat-square)
![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20HTTP-0A7CFF?style=flat-square)
![Traceability](https://img.shields.io/badge/Traceability-UC%20%2F%20MC%20%2F%20FC%20%2F%20BA-7C3AED?style=flat-square)
![Legacy](https://img.shields.io/badge/Legacy-Onboarding-059669?style=flat-square)

---

## Что Это

`GRACE` переводит AI-разработку из режима “дай модели весь репозиторий и надейся” в режим управляемого процесса:

- явные состояния workflow вместо prompt-only discipline
- policy-as-code guards для критичных переходов
- контрактная адресация `UC / MC / FC / BA`
- полная evidence-цепочка: state, transitions, executions, skill traces, reports
- bounded swarm path для ролей `architect`, `coordinator`, `coder`
- legacy onboarding поверх существующего репозитория без переписывания исходников

Репозиторий intentionally framework-first: внутри есть bootstrap templates, runtime assets и skill-first runtime surface для агентов, а не набор случайных examples.

## Архитектура

- `src/` — runtime, state machine, workflow graph, policy engine, validators, legacy onboarding
- `agents/` — role descriptors и shared skills
- `tools/` — bootstrap, validate, verify и служебные CLI
- `mcp/` — встроенный MCP-сервер поверх реального runtime
- `docs/grace/` — policy, state, approvals и framework artifacts

Ключевой принцип: агент не управляет процессом напрямую. Процессом управляют состояние, policy и разрешенные переходы.

## Основные Возможности

### Workflow Engine

- governed workflow через `LangGraph`
- approval / reject branches
- blocked state и issue reports при policy failure
- recovery path для failure memory, forced context и loop guard

### Swarm Runtime

- роли `architect`, `coordinator`, `coder`
- bounded execution windows
- полный audit trail на каждый запуск роли:
  - `TaskPacket`
  - `Invocation`
  - `Execution`
  - `SkillTrace`

### Legacy Onboarding

Поддерживаемый путь для старого репозитория:

1. overlay bootstrap
2. repository scan
3. risk report
4. contract inference
5. trace graph seed
6. slice proposal
7. governed onboarding workflow
8. dry-run safe edit

Это позволяет натягивать `GRACE` поверх legacy-кода без ручного переписывания проекта под framework.

## MCP

`MCP` встроен прямо в репозиторий, в папке `mcp/`.

Основные группы tools:

- `grace.products.*`
- `grace.workflow.*`
- `grace.legacy.*`
- `grace.agent.*`
- `grace.process.*`
- `grace.report.*`
- `grace.artifact.*`

Поддерживаются оба транспорта:

- `stdio`
- streamable HTTP `POST /mcp`

## Структура Репозитория

```text
agents/          role descriptors и shared skills
docs/grace/      framework artifacts, policies, state, reports
mcp/             MCP server
src/             core runtime и legacy onboarding
tools/           bootstrap, validate, verify, maintenance CLI
package.json
README.md
```

## Быстрый Старт

### Установка

```bash
npm install
cd mcp
npm install
cd ..
```

### Сборка

```bash
npm run build
npm run build:tools
npm run mcp:build
```

### Тесты

```bash
npm test
npm run mcp:test
```

### Валидация И Полная Проверка

```bash
npm run validate
npm run verify
```

## Запуск Workflow

```bash
npm run workflow:start
npm run workflow:resume
```

Runtime хранит:

- текущее состояние в `docs/grace/state/WorkflowState.json`
- историю переходов в `docs/grace/state/TransitionLog.jsonl`

## Запуск MCP

### stdio

```bash
npm run mcp:start
```

### HTTP

```bash
npm run mcp:start:http
```

## Production Переменные Окружения

Для HTTP deployment:

- `PORT`
- `GRACE_MCP_AUTH_TOKEN`
- `GRACE_MCP_PROTOCOL_VERSION`
- `GRACE_MCP_REQUIRE_VERSION_HEADER`
- `GRACE_MCP_MAX_BODY_BYTES`
- `GRACE_MCP_RATE_LIMIT_PER_MINUTE`
- `GRACE_MCP_REQUEST_TIMEOUT_MS`

Что они делают:

- `AUTH_TOKEN` — bearer auth для `POST /mcp`
- `PROTOCOL_VERSION` — контракт версии между сервером и клиентом
- `REQUIRE_VERSION_HEADER` — требование заголовка версии от клиента
- `MAX_BODY_BYTES` — лимит размера запроса
- `RATE_LIMIT_PER_MINUTE` — простой in-memory rate limit
- `REQUEST_TIMEOUT_MS` — timeout HTTP-слоя

## Для Чего Это Подходит

### Новый продукт

- bootstrap workspace
- заполнить living docs
- запустить governed workflow
- вести разработку через bounded slices

### Legacy репозиторий

- поднять overlay
- получить scan, risk map, draft contracts и graph registry
- открыть первый safe slice
- проверить change path через dry-run, а потом разрешать запись

### Внешний агент или Codex

- подключить `mcp/`
- читать state, blockers, trace и artifacts
- запускать workflow и legacy onboarding через MCP tools

## Позиционирование

`GRACE` — это не набор промптов и не “магический агент”.

Это production-oriented runtime для работы ИИ по контрактам, состояниям, policy и traceability.
