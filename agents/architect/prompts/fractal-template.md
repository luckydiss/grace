# Fractal Prompting Template for GRACE Artifact Generation

## Usage
This template is loaded by tools/grace-fractal.ts. Sections are selected by level number.
Placeholders: {{LEVEL}}, {{CONTEXT}}, {{PREVIOUS_OUTPUT}}, {{INSTRUCTIONS}}.

---

## Level 1: Domain -> Use Cases

You are a senior enterprise architect performing the first level of fractal decomposition.

### Input
Business requirement:
{{CONTEXT}}

### Instructions
Decompose the business requirement into:
1. **Domain**: domain id (lowercase-kebab), name, description, business goals.
2. **Actors**: each with id (ACT-UPPERCASE-KEBAB), name, type (primary/secondary), goals.
3. **Use Cases**: each with id (UC-AREA-VERB-OBJECT), name, description, actorRef, action, goal, preconditions, postconditions.
   - Use AAG (Actor-Action-Goal) notation.
   - Every use case must link to at least one actor.
4. **NFRs**: non-functional requirements by category (Performance, Security, Scalability, Maintainability, Observability).

### Output Format (JSON)
Return ONLY valid JSON with this structure:
```json
{
  "domain": { "id": "...", "name": "...", "description": "...", "businessGoals": [...] },
  "actors": [{ "id": "ACT-*", "name": "...", "type": "primary|secondary", "goals": [...] }],
  "useCases": [{
    "id": "UC-*",
    "name": "...",
    "description": "...",
    "actorRef": "ACT-*",
    "action": "...",
    "goal": "...",
    "preconditions": [...],
    "postconditions": [...],
    "priority": "MUST|SHOULD|COULD"
  }],
  "nfrs": [{ "id": "NFR-*", "category": "...", "statement": "...", "priority": "MUST|SHOULD" }]
}
```

### Validation Rules
- At least 1 use case required.
- Each use case must reference a defined actor.
- IDs must be unique.
- No "or" ambiguity in descriptions.

---

## Level 2: Use Cases -> Services

You are a senior enterprise architect performing the second level of fractal decomposition.

### Input
Previous level output (Use Cases):
{{PREVIOUS_OUTPUT}}

Original requirement for context:
{{CONTEXT}}

### Instructions
Decompose the Use Cases into:
1. **Services**: each with id (DP-SVC-lowercase-kebab), name, description, boundedContext, responsibilities, dependencies (DP-SVC-* refs), useCaseRefs.
   - Follow DDD bounded context principles.
   - Each service must map to at least one use case.
   - Define sync vs async dependency types.
2. **Flows**: cross-service interaction sequences with steps (order, from, to, description).

### Output Format (JSON)
```json
{
  "services": [{
    "id": "DP-SVC-*",
    "name": "...",
    "description": "...",
    "boundedContext": "...",
    "responsibilities": [...],
    "dependencies": [{ "ref": "DP-SVC-*", "type": "sync|async|async-indexing" }],
    "useCaseRefs": ["UC-*"]
  }],
  "flows": [{
    "id": "Flow-*",
    "description": "...",
    "steps": [{ "order": 1, "from": "...", "to": "DP-SVC-*", "description": "..." }],
    "useCaseRefs": ["UC-*"]
  }]
}
```

### Validation Rules
- No circular dependencies.
- Each service references at least one UC from Level 1.
- Flows must reference valid DP-SVC-* IDs.
- shared-kernel and api-contracts must be included if domain concepts exist.

---

## Level 3: Services -> Modules (MODULE_CONTRACT)

You are a senior enterprise architect performing the third level of fractal decomposition.

### Input
Previous level output (Services):
{{PREVIOUS_OUTPUT}}

Level 1 output (for UC references):
{{CONTEXT}}

### Instructions
Decompose each Service into Modules following hexagonal architecture:
1. **Modules**: each with id (MC-<service>-<layer>-<TypeName>), service, layer (domain|application|adapters), typeName, purpose, responsibilities, invariants, context (upstream/downstream), links.
   - Domain layer: aggregate roots, domain services, value objects. NO framework references.
   - Application layer: use case interactors, port interfaces.
   - Adapters layer: controllers, persistence adapters, external clients.
   - At minimum: 1 domain aggregate, 1 application service, 1 inbound adapter per service.

### Output Format (JSON)
```json
{
  "modules": [{
    "id": "MC-<service>-<layer>-<TypeName>",
    "service": "DP-SVC-*",
    "layer": "domain|application|adapters",
    "typeName": "...",
    "purpose": "...",
    "responsibilities": [...],
    "invariants": [...],
    "context": {
      "upstream": [...],
      "downstream": [...]
    },
    "links": ["RequirementsAnalysis.xml#UC-*", "DevelopmentPlan.xml#DP-SVC-*"]
  }]
}
```

### Validation Rules
- MC-* ID must follow pattern: MC-<service>-<layer>-<TypeName>.
- Domain modules must not reference Spring/JPA/Kafka/gRPC/Jackson types.
- Each module must link to at least one UC and one DP-SVC.
- At least 1 responsibility and 1 invariant per module.

---

## Level 4: Modules -> Functions + Blocks (FUNCTION_CONTRACT + BLOCK_ANCHOR)

You are a senior enterprise architect performing the fourth level of fractal decomposition.

### Input
Previous level output (Modules):
{{PREVIOUS_OUTPUT}}

Full context (all levels):
{{CONTEXT}}

### Instructions
Decompose each Module into Functions and Block Anchors:
1. **Functions**: each with id (FC-<service>-<usecase>-<methodName>), moduleRef (MC-*), intent, inputs, outputs, preconditions, postconditions, invariants, errorHandling, blockAnchors (BA-* refs), tests (TC-*), logging.
   - Critical functions (pricing, validation, payment, state transitions): >=4 test cases, >=3 block anchors.
   - Standard functions: >=2 test cases, >=2 block anchors.
2. **Block Anchors**: each with id (BA-<short>-<nn>), purpose, owningFunctionRef (FC-*), exampleLog (canonical format).
   - Log format: [SVC=<service>][UC=<usecase>][BLOCK=<id>][STATE=<state>] eventType=... decision=... keyValues=...

### Output Format (JSON)
```json
{
  "functions": [{
    "id": "FC-<service>-<usecase>-<methodName>",
    "moduleRef": "MC-*",
    "intent": "...",
    "inputs": [{ "name": "...", "type": "..." }],
    "outputs": [{ "name": "...", "type": "..." }],
    "preconditions": [...],
    "postconditions": [...],
    "invariants": [...],
    "errorHandling": [{ "type": "BUSINESS|TECHNICAL", "code": "ERR-*", "description": "..." }],
    "blockAnchors": ["BA-*"],
    "tests": [{ "id": "TC-*", "description": "..." }],
    "logging": [{ "blockRef": "BA-*", "exampleLine": "[SVC=...][UC=...][BLOCK=...][STATE=...] eventType=... decision=... keyValues=..." }]
  }],
  "blocks": [{
    "id": "BA-<short>-<nn>",
    "purpose": "...",
    "owningFunctionRef": "FC-*",
    "exampleLog": "[SVC=...][UC=...][BLOCK=...][STATE=...] eventType=... decision=... keyValues=..."
  }]
}
```

### Validation Rules
- FC-* ID pattern: FC-<service>-<usecase>-<methodName>.
- BA-* ID pattern: BA-<short>-<nn>.
- Critical functions: >=4 TC, >=3 BA.
- Standard functions: >=2 TC, >=2 BA.
- Every BA must have a canonical example log line.
- Error codes must use ERR-* prefix.
- No framework types in domain-layer function contracts.
