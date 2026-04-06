# 🔌 GRACE MCP Server

> **Официальный Model Context Protocol (MCP) сервер для фреймворка GRACE.**  
> Предоставляет внешний программный доступ к runtime-модели GRACE для AI-агентов (Codex, Cursor, Claude Desktop), операторских UI и систем автоматизации без дублирования бизнес-логики.

---

![MCP](https://img.shields.io/badge/MCP-Server-0A7CFF?style=flat-square)
![Transport](https://img.shields.io/badge/Transport-stdio%20%2B%20HTTP-0A7CFF?style=flat-square)
![Security](https://img.shields.io/badge/Security-Bearer%20Auth%20%2B%20Rate%20Limit-DC2626?style=flat-square)
![Protocol](https://img.shields.io/badge/Protocol-Versioned-111827?style=flat-square)

---

## 📖 Содержание
1. [Назначение и Архитектура](#-назначение-и-архитектурная-роль)
2. [Режимы Транспорта (Transport Modes)](#-режимы-транспорта-transport-modes)
3. [Публичный Интерфейс (Tools & Resources)](#-публичный-интерфейс-tools--resources)
4. [Модель Безопасности и HTTP Runtime](#-модель-безопасности-и-http-runtime)
5. [Развертывание и Запуск](#%EF%B8%8F-развертывание-и-запуск)
6. [Интеграция с Клиентами (Codex, IDE)](#-интеграция-с-клиентами)

---

## 🎯 Назначение и Архитектурная Роль

`GRACE MCP` — это "пульт управления" для вашего GRACE-фреймворка. Он используется как внешний *control plane* для подключения ИИ-агентов к вашей кодовой базе.

**Ключевое правило:** Сервер является *тонким прокси* (thin wrapper).  
Он не дублирует оркестрацию (orchestration logic) в отдельный слой. Все команды прокидываются строго в ядро фреймворка `GRACE`, которое генерирует переходы состояний, проверяет политики и формирует артефакты. Это гарантирует отсутствие двойного источника правды (Single Source of Truth) и оставляет сервер легковесным.

**Для чего это нужно?**
- Подключение **Codex / Cursor / LLM Agents** к процессам разработки (так, чтобы они подчинялись правилам GRACE).
- Построение аналитических дашбордов и операторских UI.
- Интеграция между различными внутренними сервисами компании.
- Аудит безопасности работы ИИ.

---

## 🚀 Режимы Транспорта (Transport Modes)

Сервер поддерживает два стандарта связи в рамках Model Context Protocol:

### 1. `stdio` (Стандартный ввод-вывод)
Идеален для локального запуска (например, внутри вашей IDE или десктопного агента). Агент вызывает MCP как дочерний процесс операционной системы.
- Запуск из корня GRACE: `npm run mcp:start`
- Запуск прямо из директории mcp: `npm run start`

### 2. `HTTP POST` (Сетевой доступ)
Используется для удаленных клиентов, ИИ-шлюзов (Agent Gateways) и интеграции микросервисов. В этом режиме сервер поднимает полноценный HTTP сервер.
- **Endpoint**: `POST /mcp` (Методы GET и DELETE заблокированы с кодом `405`).
- Поддержка жестких лимитов безопасности и авторизации.
- Запуск из корня: `npm run mcp:start:http`

---

## 🛠 Публичный Интерфейс (Tools & Resources)

Сервер предоставляет богатый набор "инструментов" (Tools для изменения состояния) и "ресурсов" (Resources для чтения).

### 🛠 Tools (Инструменты Мутации и Анализа)

#### 1. Управление Продуктами и Базовым Жизненным Циклом
- `grace.products.list` / `bootstrap` / `validate` / `start_workflow`
*Создание, инициализация и запуск процессов над продуктами.*

#### 2. Workflow & Оркестрация
- `grace.workflow.state` / `history` / `blockers` / `trace`  **(Observability)**
- `grace.workflow.start` / `resume` / `approve` / `reject`  **(Lifecycle Control)**
- `grace.workflow.execution_proof` / `delivery_trace`  **(Внешняя валидация)**
*Чтение причин блокировок машин состояний, проверка истории переходов и ручное управление прерываниями (appoval).*

#### 3. Legacy Подсистема
- `grace.legacy.bootstrap` / `scan` / `infer_contracts` / `slice_propose`
- `grace.legacy.start_onboarding` / `edit_dry_run`
*Позволяет агенту ИИ просканировать старый проект, предложить "срез" для рефакторинга и прогнать Dry-Run изменений без порчи кода.*

#### 4. Внутренняя Инспекция (Evidence & Agent Tools)
- `grace.agent.evidence` / `grace.agent.trace`
- `grace.process.artifacts`
- `grace.autonomy.status`
*Доступ к памяти об ошибках (failure memory), журналам вызовов (traces) навыков агентов и конкретным артефактам.*

### 📂 Resources (Ресурсы только для чтения)

Ресурсы возвращаются через строгий URI для максимального удобства интеграции на стороне LLM. Большинство тулов автоматически триггерят `resources/list_changed` при мутации.
- `grace://server/info`
- `grace://products`
- `grace://product/{productId}/state` (а также `/history`, `/trace`, `/blockers`, `/autonomy`)
- `grace://product/{productId}/legacy/overlay` (а также `/source-map`, `/scan`, `/contracts`, `/graph`, `/slices`)

---

## 🔒 Модель Безопасности и HTTP Runtime

Если вы используете `HTTP POST`, GRACE MCP предоставляет продакшен-ready систему защиты.

### 1. Bearer Authentication
Для активации защиты задайте `GRACE_MCP_AUTH_TOKEN`.
Сервер будет принимать только вызовы с заголовком:
```http
Authorization: Bearer <your-token>
```
*Без токена: ответ `401 Unauthorized` + Header `WWW-Authenticate: Bearer realm="grace-mcp"`*

### 2. Protocol Version Enforcement (Проверка версии)
Запрещает старым клиентам общаться с сервером по устаревшему контракту.  
Включается флагом `GRACE_MCP_REQUIRE_VERSION_HEADER=true`.
Требует заголовок: `x-grace-mcp-protocol-version: 2026-04-05`.

### 3. Защита от спама и Payload-атак
- **Body Limit**: Флаг `GRACE_MCP_MAX_BODY_BYTES` запрещает огромные JSON-тела (ответ `413 Payload Too Large`). По умолчанию — 1MB.
- **Rate Limit**: Флаг `GRACE_MCP_RATE_LIMIT_PER_MINUTE` активирует in-memory защиту от DDOS (по IP). `429 Too Many Requests`.
- **Request Timeout**: Ограничение максимального времени ответа базы.

Все сетевые ошибки сервера совместимы со стандартом `JSON-RPC`, что делает интеграцию предсказуемой.

---

## ⚙️ Развертывание и Запуск

### Установка пакета
MCP пакет изолирован, вы можете ставить пакеты отдельно:
```bash
# Для всего GRACE
cd ../ && npm install

# Только MCP
cd mcp && npm install
```

### Сборка
```bash
cd mcp && npm run build
```

### Тестирование пакета
```bash
cd mcp && npm test
```
*Тесты покрывают HTTP-транспорт, роутер, валидацию заголовков, лимиты, auth-слой и провязку с Workflow Engine.*

### Пример Production Deployment (HTTP)
Для сервера в докер-контейнере или как SystemD сервис:
```bash
# Установка важных Production-флагов (Linux / macOS)
export GRACE_MCP_AUTH_TOKEN="replace-with-mega-secure-token"
export GRACE_MCP_PROTOCOL_VERSION="2026-04-05"
export GRACE_MCP_REQUIRE_VERSION_HEADER="true"
export GRACE_MCP_MAX_BODY_BYTES="1048576"            
export GRACE_MCP_RATE_LIMIT_PER_MINUTE="60"          
export GRACE_MCP_REQUEST_TIMEOUT_MS="30000"          
export PORT="3001"

npm run start:http
```

---

## 🔌 Интеграция с Клиентами

### Пример для локального агента (Codex / Cursor)
Для локальных агентов вы обычно настраиваете конфигурационный файл MCP клиента.
Пример конфигурации (`mcp.json` / `cursor.json`):
```json
{
  "mcpServers": {
    "grace-local": {
      "command": "npm",
      "args": ["run", "start"],
      "cwd": "/path/to/grace/mcp"
    }
  }
}
```

### HTTP Вызов из любого приложения
```bash
curl -X POST http://127.0.0.1:3001/mcp \
  -H "Authorization: Bearer replace-with-mega-secure-token" \
  -H "x-grace-mcp-protocol-version: 2026-04-05" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "grace.products.list", "arguments": {}}}'
```

---

### Резюме
Используйте `GRACE MCP` когда вам нужно дать вашему ИИ-ассистенту API-доступ к коду с жесткими, детерминированными ограничениями, отчетами о рисках и контрактной маршрутизацией, которую гарантирует фреймворк GRACE.
