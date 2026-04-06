# GRACE MCP

`grace-mcp` — встроенный MCP-сервер для `GRACE`. Он не дублирует orchestration logic, а открывает наружу реальный workflow runtime.

## Что Доступно

### Products

- `grace.products.list`
- `grace.products.bootstrap`
- `grace.products.start_workflow`
- `grace.products.validate`

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

### Legacy

- `grace.legacy.bootstrap`
- `grace.legacy.validate`
- `grace.legacy.scan`
- `grace.legacy.infer_contracts`
- `grace.legacy.trace_seed`
- `grace.legacy.slice_propose`
- `grace.legacy.start_onboarding`
- `grace.legacy.edit_dry_run`

### Evidence И Artifacts

- `grace.agent.evidence`
- `grace.agent.trace`
- `grace.process.artifacts`
- `grace.report.read`
- `grace.artifact.read`
- `grace.autonomy.status`
- `grace.server.info`

## Resources

- `grace://server/info`
- `grace://products`
- `grace://product/{productId}/state`
- `grace://product/{productId}/history`
- `grace://product/{productId}/trace`
- `grace://product/{productId}/blockers`
- `grace://product/{productId}/autonomy`
- `grace://product/{productId}/agents`
- `grace://product/{productId}/process`
- `grace://product/{productId}/legacy/overlay`
- `grace://product/{productId}/legacy/source-map`
- `grace://product/{productId}/legacy/scan`
- `grace://product/{productId}/legacy/contracts`
- `grace://product/{productId}/legacy/graph`
- `grace://product/{productId}/legacy/slices`

Mutation tools отправляют `resources/list_changed`, чтобы клиент мог обновлять состояние после bootstrap и workflow changes.

## Команды

Из корня репозитория:

```bash
npm run mcp:build
npm run mcp:test
npm run mcp:start
npm run mcp:start:http
```

Из папки `mcp/`:

```bash
npm run build
npm run test
npm run start
npm run start:http
```

## HTTP Режим

- `POST /mcp` — MCP requests
- `GET /mcp` и `DELETE /mcp` — `405`
- `PORT` по умолчанию `3001`

## Production Переменные

- `GRACE_MCP_AUTH_TOKEN`
- `GRACE_MCP_PROTOCOL_VERSION`
- `GRACE_MCP_REQUIRE_VERSION_HEADER`
- `GRACE_MCP_MAX_BODY_BYTES`
- `GRACE_MCP_RATE_LIMIT_PER_MINUTE`
- `GRACE_MCP_REQUEST_TIMEOUT_MS`

HTTP-ответы включают:

- `x-grace-mcp-server-name`
- `x-grace-mcp-server-version`
- `x-grace-mcp-protocol-version`
