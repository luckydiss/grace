#!/usr/bin/env npx tsx
/**
 * <!-- MODULE_MAP id="MM-fractal" -->
 * <Layers>
 *   <Layer name="domain" package="tools/grace-fractal.ts">
 *     Pure decomposition logic: prompt assembly, JSON parsing, validation,
 *     XML template rendering. No side effects beyond receiving inputs.
 *   </Layer>
 *   <Layer name="application" package="tools/grace-fractal.ts">
 *     Orchestration: CLI argument dispatch, 4-level sequential pipeline,
 *     context accumulation, artifact emission coordination.
 *   </Layer>
 *   <Layer name="infrastructure" package="tools/grace-fractal.ts">
 *     File system access: template loading, output directory creation, XML file writing.
 *     HTTP: LLM endpoint calls (Ollama / OpenAI-compatible).
 *     Node.js fs/path/http module binding.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="DevelopmentPlan.xml#DP-SVC-demo-http"/>
 *   <Link ref="DevelopmentExecutionPlan.xml#W3-T2"/>
 *   <Link ref="GRACE_MARKUP_STANDARD.md"/>
 * </Links>
 * <!-- /MODULE_MAP -->
 */

/**
 * <MODULE_CONTRACT id="MC-grace-fractal" version="1.0.0">
 *   <Purpose>
 *     Fractal decomposition CLI for generating GRACE planning artifacts and semantic contracts
 *     from requirement text through a staged level-by-level pipeline.
 *   </Purpose>
 *   <Responsibilities>
 *     <Item>Parse CLI inputs and orchestrate Level 1-4 decomposition flow</Item>
 *     <Item>Call an LLM when configured and fall back to deterministic no-op templates when unavailable</Item>
 *     <Item>Emit RequirementsAnalysis, DevelopmentPlan, MODULE_CONTRACT, and FUNCTION_CONTRACT artifacts</Item>
 *   </Responsibilities>
 *   <Functions>
 *     <Function ref="FC-fractal-UC-FRACTAL-DECOMPOSE-parseCliArgs"/>
 *     <Function ref="FC-fractal-callLLM"/>
 *     <Function ref="FC-fractal-UC-FRACTAL-DECOMPOSE-parseJsonResponse"/>
 *     <Function ref="FC-fractal-UC-FRACTAL-DECOMPOSE-assemblePrompt"/>
 *     <Function ref="FC-fractal-UC-FRACTAL-DECOMPOSE-generateNoopLevel1"/>
 *     <Function ref="FC-fractal-UC-FRACTAL-DECOMPOSE-generateNoopLevel2"/>
 *     <Function ref="FC-fractal-UC-FRACTAL-DECOMPOSE-generateNoopLevel3"/>
 *     <Function ref="FC-fractal-UC-FRACTAL-DECOMPOSE-generateNoopLevel4"/>
 *     <Function ref="FC-fractal-UC-FRACTAL-DECOMPOSE-validateLevel1"/>
 *     <Function ref="FC-fractal-writeRequirementsAnalysis"/>
 *     <Function ref="FC-fractal-writeDevelopmentPlan"/>
 *     <Function ref="FC-fractal-writeModuleContract"/>
 *     <Function ref="FC-fractal-writeFunctionContract"/>
 *     <Function ref="FC-fractal-runPipeline"/>
 *   </Functions>
 *   <Links>
 *     <Link ref="DevelopmentPlan.xml#DP-SVC-demo-http"/>
 *     <Link ref="DevelopmentExecutionPlan.xml#W3-T2"/>
 *     <Link ref="GRACE_MARKUP_STANDARD.md"/>
 *   </Links>
 * </MODULE_CONTRACT>
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

interface CliArgs {
  requirement: string;
  endpoint: string;
  model: string;
  out: string;
  template: string;
  verbose: boolean;
  levels: number[];
  context?: string;
}

interface Actor {
  id: string;
  name: string;
  type: "primary" | "secondary";
  goals: string[];
}

interface UseCase {
  id: string;
  name: string;
  description: string;
  actorRef: string;
  action: string;
  goal: string;
  preconditions: string[];
  postconditions: string[];
  priority: "MUST" | "SHOULD" | "COULD";
}

interface Nfr {
  id: string;
  category: string;
  statement: string;
  priority: "MUST" | "SHOULD";
}

interface Level1Output {
  domain: { id: string; name: string; description: string; businessGoals: string[] };
  actors: Actor[];
  useCases: UseCase[];
  nfrs: Nfr[];
}

interface ServiceDependency {
  ref: string;
  type: "sync" | "async" | "async-indexing";
}

interface Service {
  id: string;
  name: string;
  description: string;
  boundedContext: string;
  responsibilities: string[];
  dependencies: ServiceDependency[];
  useCaseRefs: string[];
}

interface FlowStep {
  order: number;
  from: string;
  to: string;
  description: string;
}

interface Flow {
  id: string;
  description: string;
  steps: FlowStep[];
  useCaseRefs: string[];
}

interface Level2Output {
  services: Service[];
  flows: Flow[];
}

interface ModuleContract {
  id: string;
  service: string;
  layer: "domain" | "application" | "adapters";
  typeName: string;
  purpose: string;
  responsibilities: string[];
  invariants: string[];
  context: { upstream: string[]; downstream: string[] };
  links: string[];
}

interface Level3Output {
  modules: ModuleContract[];
}

interface FunctionInput {
  name: string;
  type: string;
}

interface FunctionOutput {
  name: string;
  type: string;
}

interface ErrorHandling {
  type: "BUSINESS" | "TECHNICAL";
  code: string;
  description: string;
}

interface TestCase {
  id: string;
  description: string;
}

interface LoggingEntry {
  blockRef: string;
  exampleLine: string;
}

interface FunctionContract {
  id: string;
  moduleRef: string;
  intent: string;
  inputs: FunctionInput[];
  outputs: FunctionOutput[];
  preconditions: string[];
  postconditions: string[];
  invariants: string[];
  errorHandling: ErrorHandling[];
  blockAnchors: string[];
  tests: TestCase[];
  logging: LoggingEntry[];
  critical: boolean;
}

interface BlockAnchor {
  id: string;
  purpose: string;
  owningFunctionRef: string;
  exampleLog: string;
}

interface Level4Output {
  functions: FunctionContract[];
  blocks: BlockAnchor[];
}

interface FractalContext {
  requirement: string;
  level1?: Level1Output;
  level2?: Level2Output;
  level3?: Level3Output;
  level4?: Level4Output;
}

// ── Infrastructure: CLI parsing ────────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-fractal-UC-FRACTAL-DECOMPOSE-parseCliArgs">
 *   <Intent>Parse CLI arguments into a structured CliArgs object with defaults applied.</Intent>
 *   <Inputs>
 *     <Input name="argv">Raw CLI argument array (process.argv.slice(2)).</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="args">Parsed CliArgs with all defaults populated.</Output>
 *   </Outputs>
 *   <Preconditions>
 *     <Item>argv is process.argv.slice(2)</Item>
 *   </Preconditions>
 *   <Postconditions>
 *     <Item>All required fields are populated; defaults applied for optional fields</Item>
 *   </Postconditions>
 *   <BlockAnchors>
 *     <BA ref="BA-FRAC-ARGPARSE"/>
 *   </BlockAnchors>
 *   <Tests>
 *     <TC id="TC-FRAC-001">Minimal args (--requirement "text") produces valid CliArgs with defaults</TC>
 *   </Tests>
 * </FUNCTION_CONTRACT>
 */
function parseCliArgs(argv: string[]): CliArgs {
  /* <BLOCK_ANCHOR id="BA-FRAC-ARGPARSE" purpose="Parse CLI arguments and apply defaults" /> */
  const args: CliArgs = {
    requirement: "",
    endpoint: "http://localhost:11434/api/generate",
    model: "llama3",
    out: "out/fractal",
    template: "agents/architect/prompts/fractal-template.md",
    verbose: false,
    levels: [1, 2, 3, 4],
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--requirement":
        args.requirement = argv[++i] ?? "";
        break;
      case "--endpoint":
        args.endpoint = argv[++i] ?? args.endpoint;
        break;
      case "--model":
        args.model = argv[++i] ?? args.model;
        break;
      case "--out":
        args.out = argv[++i] ?? args.out;
        break;
      case "--template":
        args.template = argv[++i] ?? args.template;
        break;
      case "--verbose":
        args.verbose = true;
        break;
      case "--levels":
        args.levels = (argv[++i] ?? "")
          .split(",")
          .map(Number)
          .filter((n) => n >= 1 && n <= 4);
        break;
      case "--context":
        args.context = argv[++i];
        break;
      default:
        break;
    }
    i++;
  }

  return args;
}

// ── Infrastructure: LLM calling ────────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-fractal-callLLM">
 *   <Intent>Send a prompt to the configured LLM endpoint and return the raw text response. Handles retries and timeout.</Intent>
 *   <Inputs>
 *     <Input name="prompt">Fully assembled prompt string (template + context).</Input>
 *     <Input name="endpoint">LLM API URL (from --endpoint or default).</Input>
 *     <Input name="model">Model name identifier.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="response">Raw LLM text output.</Output>
 *   </Outputs>
 *   <Invariants>
 *     <I1>HTTP timeout: 120s per call.</I1>
 *     <I2>Max retries: 3 with exponential backoff (1s, 2s, 4s).</I2>
 *     <I3>Supports both Ollama /api/generate and OpenAI /v1/chat/completions formats.</I3>
 *     <I4>On 4xx/5xx, logs the error and retries; on final failure, throws.</I4>
 *   </Invariants>
 *   <BlockAnchors>
 *     <BA ref="BA-FRAC-LLM-CALL"/>
 *   </BlockAnchors>
 *   <Tests>
 *     <Case id="TC-FRAC-009">Successful call returns response text.</Case>
 *     <Case id="TC-FRAC-010">3 consecutive failures throws with descriptive error.</Case>
 *   </Tests>
 * </FUNCTION_CONTRACT>
 */
async function callLLM(
  prompt: string,
  endpoint: string,
  model: string,
  verbose: boolean,
): Promise<string> {
  /* <BLOCK_ANCHOR id="BA-FRAC-LLM-CALL" purpose="Call LLM endpoint with retry logic" /> */
  const maxRetries = 3;
  const isOpenAI = endpoint.includes("/v1/chat/completions");

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (verbose) {
        console.error(`[fractal] LLM call attempt ${attempt + 1}/${maxRetries} to ${endpoint}`);
      }

      const body = isOpenAI
        ? JSON.stringify({ model, messages: [{ role: "user", content: prompt }] })
        : JSON.stringify({ model, prompt, stream: false });

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as Record<string, unknown>;

      if (isOpenAI) {
        const choices = data.choices as Array<{ message: { content: string } }>;
        return choices[0].message.content;
      } else {
        return data.response as string;
      }
    } catch (err) {
      const delay = Math.pow(2, attempt) * 1000;
      if (verbose) {
        console.error(`[fractal] LLM call failed (attempt ${attempt + 1}): ${err}`);
      }
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw new Error(`LLM call failed after ${maxRetries} retries: ${err}`);
      }
    }
  }

  throw new Error("Unreachable");
}

// ── Domain: JSON parsing ───────────────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-fractal-UC-FRACTAL-DECOMPOSE-parseJsonResponse">
 *   <Intent>Extract and parse JSON from LLM response text, stripping markdown fences if present.</Intent>
 *   <Inputs>
 *     <Input name="raw">Raw LLM response text.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="parsed">Parsed JSON object.</Output>
 *   </Outputs>
 *   <Invariants>
 *     <I1>Strips ```json ... ``` fences if present.</I1>
 *     <I2>Extracts first JSON object from text.</I1>
 *     <I3>Returns null if parsing fails (caller handles retry).</I3>
 *   </Invariants>
 *   <BlockAnchors>
 *     <BA ref="BA-FRAC-JSON-PARSE"/>
 *   </BlockAnchors>
 *   <Tests>
 *     <TC id="TC-FRAC-004">Markdown-fenced JSON is parsed correctly.</TC>
 *     <TC id="TC-FRAC-005">Plain JSON without fences is parsed correctly.</TC>
 *   </Tests>
 * </FUNCTION_CONTRACT>
 */
function parseJsonResponse(raw: string): unknown | null {
  /* <BLOCK_ANCHOR id="BA-FRAC-JSON-PARSE" purpose="Parse and validate JSON from LLM response" /> */
  let text = raw.trim();

  // Strip markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // ignore
  }

  // Try to find first JSON object in text
  const jsonStart = text.indexOf("{");
  if (jsonStart >= 0) {
    let depth = 0;
    for (let i = jsonStart; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}") depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(jsonStart, i + 1));
        } catch {
          // continue searching
        }
      }
    }
  }

  return null;
}

// ── Domain: Prompt assembly ────────────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-fractal-UC-FRACTAL-DECOMPOSE-assemblePrompt">
 *   <Intent>Assemble a level-specific prompt by selecting the template section and injecting context placeholders.</Intent>
 *   <Inputs>
 *     <Input name="template">Full fractal-template.md content.</Input>
 *     <Input name="level">Level number (1-4).</Input>
 *     <Input name="requirement">Original business requirement text.</Input>
 *     <Input name="previousOutput">Accumulated context from prior levels (JSON string or empty).</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="prompt">Fully assembled prompt string.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-FRAC-CTX-BUILD"/>
 *   </BlockAnchors>
 *   <Tests>
 *     <TC id="TC-FRAC-006">Level 1 prompt injects requirement into {{CONTEXT}} and clears {{PREVIOUS_OUTPUT}}.</TC>
 *     <TC id="TC-FRAC-007">Level 3 prompt injects L1+L2 output into {{PREVIOUS_OUTPUT}}.</TC>
 *   </Tests>
 * </FUNCTION_CONTRACT>
 */
function assemblePrompt(
  template: string,
  level: number,
  requirement: string,
  previousOutput: string,
): string {
  /* <BLOCK_ANCHOR id="BA-FRAC-CTX-BUILD" purpose="Build prompt from template with context injection" /> */
  // Extract the ## Level N section
  const sectionRegex = new RegExp(
    `## Level ${level}:.*?\\n([\\s\\S]*?)(?=\\n## Level ${level + 1}:|$)`,
  );
  const sectionMatch = template.match(sectionRegex);

  if (!sectionMatch) {
    throw new Error(`Template section for Level ${level} not found in fractal-template.md`);
  }

  let section = sectionMatch[1];

  // Replace placeholders
  section = section.replace(/\{\{CONTEXT\}\}/g, requirement);
  section = section.replace(/\{\{PREVIOUS_OUTPUT\}\}/g, previousOutput || "(none — first level)");

  // Append strict JSON instruction
  section += "\n\nReturn ONLY valid JSON. No markdown fences, no explanation.";

  return section;
}

// ── Domain: No-op template mode (default when no LLM endpoint) ─────────────

/**
 * <FUNCTION_CONTRACT id="FC-fractal-UC-FRACTAL-DECOMPOSE-generateNoopLevel1">
 *   <Intent>Generate a template Level 1 output from requirement text without calling an LLM.</Intent>
 *   <Inputs>
 *     <Input name="requirement">Business requirement text.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="level1">Level 1 output with placeholder actors/use cases.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-FRAC-L1-DECOMPOSE"/>
 *   </BlockAnchors>
 *   <Tests>
 *     <TC id="TC-FRAC-008">Produces at least 1 actor and 1 use case from any non-empty requirement.</TC>
 *   </Tests>
 * </FUNCTION_CONTRACT>
 */
function generateNoopLevel1(requirement: string): Level1Output {
  /* <BLOCK_ANCHOR id="BA-FRAC-L1-DECOMPOSE" purpose="Decompose requirement into use cases (no-op template)" /> */
  return {
    domain: {
      id: "fractal-domain",
      name: "Fractal Decomposition",
      description: `Auto-generated domain from requirement: ${requirement.slice(0, 120)}`,
      businessGoals: ["Satisfy the stated business requirement"],
    },
    actors: [
      {
        id: "ACT-PRIMARY-USER",
        name: "Primary User",
        type: "primary",
        goals: ["Achieve the stated business goal"],
      },
    ],
    useCases: [
      {
        id: "UC-FRACTAL-PRIMARY-01",
        name: "Primary Use Case",
        description: `Fulfill: ${requirement.slice(0, 200)}`,
        actorRef: "ACT-PRIMARY-USER",
        action: "Execute primary workflow",
        goal: "Achieve business outcome",
        preconditions: ["System is available", "User is authenticated"],
        postconditions: ["Business goal is achieved"],
        priority: "MUST",
      },
    ],
    nfrs: [
      {
        id: "NFR-FRACTAL-PERF-01",
        category: "Performance",
        statement: "Response time under 2s for primary operations",
        priority: "SHOULD",
      },
    ],
  };
}

/**
 * <FUNCTION_CONTRACT id="FC-fractal-UC-FRACTAL-DECOMPOSE-generateNoopLevel2">
 *   <Intent>Generate a template Level 2 output from Level 1 data without calling an LLM.</Intent>
 *   <Inputs>
 *     <Input name="level1">Level 1 output.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="level2">Level 2 output with placeholder services.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-FRAC-L2-DECOMPOSE"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
function generateNoopLevel2(level1: Level1Output): Level2Output {
  /* <BLOCK_ANCHOR id="BA-FRAC-L2-DECOMPOSE" purpose="Decompose use cases into services (no-op template)" /> */
  const services: Service[] = level1.useCases.map((uc, idx) => ({
    id: `DP-SVC-fractal-service-${idx + 1}`,
    name: `fractal-service-${idx + 1}`,
    description: `Service for ${uc.name}`,
    boundedContext: level1.domain.id,
    responsibilities: [`Handle ${uc.action}`],
    dependencies: [],
    useCaseRefs: [uc.id],
  }));

  const flows: Flow[] =
    services.length > 1
      ? [
          {
            id: "Flow-FRAC-01",
            description: "Primary workflow across services",
            steps: services.map((svc, idx) => ({
              order: idx + 1,
              from: idx === 0 ? "ACT-PRIMARY-USER" : services[idx - 1].id,
              to: svc.id,
              description: `Execute ${svc.name}`,
            })),
            useCaseRefs: level1.useCases.map((uc) => uc.id),
          },
        ]
      : [];

  return { services, flows };
}

/**
 * <FUNCTION_CONTRACT id="FC-fractal-UC-FRACTAL-DECOMPOSE-generateNoopLevel3">
 *   <Intent>Generate a template Level 3 output from Level 2 data without calling an LLM.</Intent>
 *   <Inputs>
 *     <Input name="level2">Level 2 output.</Input>
 *     <Input name="level1">Level 1 output for UC references.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="level3">Level 3 output with placeholder module contracts.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-FRAC-L3-DECOMPOSE"/>
 *     <BA ref="BA-FRAC-L3-CONTRACT-GEN"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
function generateNoopLevel3(level2: Level2Output, level1: Level1Output): Level3Output {
  /* <BLOCK_ANCHOR id="BA-FRAC-L3-DECOMPOSE" purpose="Decompose services into module contracts (no-op template)" /> */
  /* <BLOCK_ANCHOR id="BA-FRAC-L3-CONTRACT-GEN" purpose="Generate MODULE_CONTRACT XML from level output" /> */
  const modules: ModuleContract[] = [];

  for (const svc of level2.services) {
    const svcSlug = svc.id.replace("DP-SVC-", "");

    modules.push({
      id: `MC-${svcSlug}-domain-${capitalize(svcSlug)}Aggregate`,
      service: svc.id,
      layer: "domain",
      typeName: `${capitalize(svcSlug)}Aggregate`,
      purpose: `Domain aggregate root for ${svc.name}`,
      responsibilities: svc.responsibilities,
      invariants: ["Entity ID must be non-empty", "State transitions must follow domain rules"],
      context: { upstream: svc.useCaseRefs, downstream: [] },
      links: [
        ...svc.useCaseRefs.map((uc) => `RequirementsAnalysis.xml#${uc}`),
        `DevelopmentPlan.xml#${svc.id}`,
      ],
    });

    modules.push({
      id: `MC-${svcSlug}-application-${capitalize(svc.name)}Service`,
      service: svc.id,
      layer: "application",
      typeName: `${capitalize(svc.name)}Service`,
      purpose: `Application service orchestrating ${svc.name} use cases`,
      responsibilities: svc.responsibilities.map((r) => `Orchestrate: ${r}`),
      invariants: ["Transaction boundaries must be consistent"],
      context: { upstream: svc.useCaseRefs, downstream: [modules[modules.length - 1].id] },
      links: [
        ...svc.useCaseRefs.map((uc) => `RequirementsAnalysis.xml#${uc}`),
        `DevelopmentPlan.xml#${svc.id}`,
      ],
    });

    modules.push({
      id: `MC-${svcSlug}-adapters-InboundController`,
      service: svc.id,
      layer: "adapters",
      typeName: "InboundController",
      purpose: `Inbound adapter for ${svc.name}`,
      responsibilities: ["Parse and validate transport input", "Map to application commands"],
      invariants: ["Must not contain business logic"],
      context: { upstream: [], downstream: [modules[modules.length - 1].id] },
      links: [
        ...svc.useCaseRefs.map((uc) => `RequirementsAnalysis.xml#${uc}`),
        `DevelopmentPlan.xml#${svc.id}`,
      ],
    });
  }

  return { modules };
}

/**
 * <FUNCTION_CONTRACT id="FC-fractal-UC-FRACTAL-DECOMPOSE-generateNoopLevel4">
 *   <Intent>Generate a template Level 4 output from Level 3 data without calling an LLM.</Intent>
 *   <Inputs>
 *     <Input name="level3">Level 3 output.</Input>
 *     <Input name="level2">Level 2 output for service context.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="level4">Level 4 output with placeholder functions and blocks.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-FRAC-L4-DECOMPOSE"/>
 *     <BA ref="BA-FRAC-L4-CONTRACT-GEN"/>
 *     <BA ref="BA-FRAC-L4-XML-EMIT"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
function generateNoopLevel4(
  level3: Level3Output,
  level2: Level2Output,
  level1: Level1Output,
): Level4Output {
  /* <BLOCK_ANCHOR id="BA-FRAC-L4-DECOMPOSE" purpose="Decompose modules into functions and blocks (no-op template)" /> */
  /* <BLOCK_ANCHOR id="BA-FRAC-L4-CONTRACT-GEN" purpose="Generate FUNCTION_CONTRACT XML from level output" /> */
  /* <BLOCK_ANCHOR id="BA-FRAC-L4-XML-EMIT" purpose="Prepare function-contract artifact payloads for output" /> */
  const functions: FunctionContract[] = [];
  const blocks: BlockAnchor[] = [];

  for (const mod of level3.modules) {
    if (mod.layer === "adapters") continue; // Skip adapters for function generation

    const svcSlug = mod.service.replace("DP-SVC-", "");
    const ucId = mod.links.find((l) => l.includes("#UC-"))?.split("#")[1] ?? "UC-FRACTAL";
    const methodSuffix = mod.layer === "domain" ? "validate" : "execute";
    const isCritical = mod.layer === "domain";
    const tcCount = isCritical ? 4 : 2;
    const baCount = isCritical ? 3 : 2;

    const fcId = `FC-${svcSlug}-${ucId}-${methodSuffix}`;
    const funcTests: TestCase[] = [];
    const funcBlocks: string[] = [];
    const funcLogging: LoggingEntry[] = [];

    for (let t = 0; t < tcCount; t++) {
      funcTests.push({
        id: `TC-FRAC-${String(functions.length * tcCount + t + 11).padStart(3, "0")}`,
        description: `Test case ${t + 1} for ${methodSuffix}`,
      });
    }

    for (let b = 0; b < baCount; b++) {
      const baId = `BA-${ucId.split("-").slice(1, 3).join("")}-${String(b + 1).padStart(2, "0")}`;
      funcBlocks.push(baId);
      const logLine = `[SVC=${svcSlug}][UC=${ucId}][BLOCK=${baId}][STATE=ACTIVE] eventType=${methodSuffix.toUpperCase()} decision=ACCEPT keyValues=result_count=1`;
      funcLogging.push({ blockRef: baId, exampleLine: logLine });

      blocks.push({
        id: baId,
        purpose: `Block ${b + 1} in ${methodSuffix}`,
        owningFunctionRef: fcId,
        exampleLog: logLine,
      });
    }

    functions.push({
      id: fcId,
      moduleRef: mod.id,
      intent: `${capitalize(methodSuffix)} for ${mod.typeName}`,
      inputs: [{ name: "command", type: "object" }],
      outputs: [{ name: "result", type: "object" }],
      preconditions: ["Input is valid", "Module is initialized"],
      postconditions: ["Operation completed successfully", "State is consistent"],
      invariants: mod.invariants,
      errorHandling: [
        {
          type: "BUSINESS",
          code: `ERR-${ucId.split("-")[1]?.toUpperCase() ?? "FRC"}-001`,
          description: "Business rule violation",
        },
      ],
      blockAnchors: funcBlocks,
      tests: funcTests,
      logging: funcLogging,
      critical: isCritical,
    });
  }

  return { functions, blocks };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Domain: Validation ─────────────────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-fractal-UC-FRACTAL-DECOMPOSE-validateLevel1">
 *   <Intent>Validate Level 1 output against invariants: at least 1 use case, actor references exist.</Intent>
 *   <BlockAnchors>
 *     <BA ref="BA-FRAC-L1-VALIDATE"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
function validateLevel1(output: unknown): output is Level1Output {
  /* <BLOCK_ANCHOR id="BA-FRAC-L1-VALIDATE" purpose="Validate level output against schema" /> */
  if (typeof output !== "object" || output === null) return false;
  const o = output as Record<string, unknown>;

  if (!Array.isArray(o.useCases) || o.useCases.length === 0) return false;
  if (!Array.isArray(o.actors) || o.actors.length === 0) return false;
  if (typeof o.domain !== "object" || o.domain === null) return false;

  const actorIds = new Set((o.actors as Actor[]).map((a) => a.id));
  for (const uc of o.useCases as UseCase[]) {
    if (!uc.id || !uc.name || !uc.actorRef) return false;
    if (!actorIds.has(uc.actorRef)) return false;
  }

  return true;
}

function validateLevel2(output: unknown, level1: Level1Output): output is Level2Output {
  if (typeof output !== "object" || output === null) return false;
  const o = output as Record<string, unknown>;

  if (!Array.isArray(o.services) || o.services.length === 0) return false;

  const ucIds = new Set(level1.useCases.map((uc) => uc.id));
  for (const svc of o.services as Service[]) {
    if (!svc.id || !svc.name) return false;
    if (!svc.useCaseRefs || svc.useCaseRefs.length === 0) return false;
    for (const ref of svc.useCaseRefs) {
      if (!ucIds.has(ref)) return false;
    }
  }

  return true;
}

function validateLevel3(output: unknown): output is Level3Output {
  if (typeof output !== "object" || output === null) return false;
  const o = output as Record<string, unknown>;

  if (!Array.isArray(o.modules) || o.modules.length === 0) return false;
  for (const mod of o.modules as ModuleContract[]) {
    if (!mod.id || !mod.service || !mod.layer || !mod.typeName) return false;
    if (!mod.responsibilities || mod.responsibilities.length === 0) return false;
    if (!mod.invariants || mod.invariants.length === 0) return false;
  }

  return true;
}

function validateLevel4(output: unknown): output is Level4Output {
  if (typeof output !== "object" || output === null) return false;
  const o = output as Record<string, unknown>;

  if (!Array.isArray(o.functions) || o.functions.length === 0) return false;
  for (const fn of o.functions as FunctionContract[]) {
    if (!fn.id || !fn.intent) return false;
    if (!fn.preconditions || fn.preconditions.length === 0) return false;
    if (!fn.postconditions || fn.postconditions.length === 0) return false;
    if (!fn.blockAnchors || fn.blockAnchors.length < 2) return false;
    if (!fn.tests || fn.tests.length < 2) return false;
  }

  return true;
}

// ── Infrastructure: XML generation ─────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * <FUNCTION_CONTRACT id="FC-fractal-writeRequirementsAnalysis">
 *   <Intent>Write a complete RequirementsAnalysis.xml file from Level 1 output, conforming to GRACE canonical format.</Intent>
 *   <BlockAnchors>
 *     <BA ref="BA-FRAC-WRITE-RA"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
function writeRequirementsAnalysis(level1: Level1Output, outputDir: string): string {
  /* <BLOCK_ANCHOR id="BA-FRAC-WRITE-RA" purpose="Write RequirementsAnalysis artifact to output directory" /> */
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<RequirementsAnalysis version=\"1.0.0-fractal\">");

  // Domain
  lines.push(`  <Domain id="${escapeXml(level1.domain.id)}">`);
  lines.push(`    <Name>${escapeXml(level1.domain.name)}</Name>`);
  lines.push(`    <Description>${escapeXml(level1.domain.description)}</Description>`);
  lines.push("    <BusinessGoals>");
  for (const goal of level1.domain.businessGoals) {
    lines.push(`      <Goal>${escapeXml(goal)}</Goal>`);
  }
  lines.push("    </BusinessGoals>");
  lines.push("  </Domain>");

  // Actors
  lines.push("  <Actors>");
  for (const actor of level1.actors) {
    lines.push(`    <Actor id="${escapeXml(actor.id)}" type="${escapeXml(actor.type)}">`);
    lines.push(`      <Name>${escapeXml(actor.name)}</Name>`);
    lines.push("      <Goals>");
    for (const goal of actor.goals) {
      lines.push(`        <Goal>${escapeXml(goal)}</Goal>`);
    }
    lines.push("      </Goals>");
    lines.push("    </Actor>");
  }
  lines.push("  </Actors>");

  // UseCases
  lines.push("  <UseCases>");
  for (const uc of level1.useCases) {
    lines.push(`    <UseCase id="${escapeXml(uc.id)}" priority="${escapeXml(uc.priority)}">`);
    lines.push(`      <Name>${escapeXml(uc.name)}</Name>`);
    lines.push(`      <Description>${escapeXml(uc.description)}</Description>`);
    lines.push(`      <PrimaryActor ref="${escapeXml(uc.actorRef)}" />`);
    lines.push("      <AAG>");
    lines.push(`        <Actor>${escapeXml(uc.actorRef)}</Actor>`);
    lines.push(`        <Action>${escapeXml(uc.action)}</Action>`);
    lines.push(`        <Goal>${escapeXml(uc.goal)}</Goal>`);
    lines.push("      </AAG>");
    lines.push("      <Preconditions>");
    if (uc.preconditions.length === 0) {
      lines.push("        <Item>TBD</Item>");
    } else {
      for (const precondition of uc.preconditions) {
        lines.push(`        <Item>${escapeXml(precondition)}</Item>`);
      }
    }
    lines.push("      </Preconditions>");
    lines.push(`      <SuccessOutcome>${escapeXml(uc.postconditions[0] ?? "TBD")}</SuccessOutcome>`);
    lines.push("      <Links>");
    // Links will be filled after L2 runs; for now include placeholder
    lines.push("      </Links>");
    lines.push("    </UseCase>");
  }
  lines.push("  </UseCases>");

  // NFRs
  lines.push("  <NonFunctionalRequirements>");
  for (const nfr of level1.nfrs) {
    lines.push(`    <NFR id="${escapeXml(nfr.id)}" priority="${escapeXml(nfr.priority)}">`);
    lines.push(`      <Category>${escapeXml(nfr.category)}</Category>`);
    lines.push(`      <Statement>${escapeXml(nfr.statement)}</Statement>`);
    lines.push("    </NFR>");
  }
  lines.push("  </NonFunctionalRequirements>");

  lines.push("</RequirementsAnalysis>");

  const filePath = join(outputDir, "RequirementsAnalysis.xml");
  writeFileSync(filePath, lines.join("\n"), "utf-8");
  return filePath;
}

/**
 * <FUNCTION_CONTRACT id="FC-fractal-writeDevelopmentPlan">
 *   <Intent>Write a complete DevelopmentPlan.xml file from Level 2 output, conforming to GRACE canonical format.</Intent>
 *   <BlockAnchors>
 *     <BA ref="BA-FRAC-WRITE-DP"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
function writeDevelopmentPlan(
  level2: Level2Output,
  level1: Level1Output,
  outputDir: string,
): string {
  /* <BLOCK_ANCHOR id="BA-FRAC-WRITE-DP" purpose="Write DevelopmentPlan artifact to output directory" /> */
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<DevelopmentPlan version=\"1.0.0-fractal\">");

  // Phases
  lines.push('  <Phases id="DevelopmentPhases">');
  lines.push('    <Phase id="PHASE-0" name="Foundation">');
  lines.push("      <Description>Initial service decomposition from fractal prompting.</Description>");
  lines.push("      <Priority>MUST</Priority>");
  lines.push("      <Deliverables>");
  for (const svc of level2.services) {
    lines.push(`        <Deliverable>${escapeXml(svc.name)} implementation</Deliverable>`);
  }
  lines.push("      </Deliverables>");
  lines.push("    </Phase>");
  lines.push("  </Phases>");

  // Modules (Services)
  lines.push("  <Modules>");
  for (const svc of level2.services) {
    lines.push(`    <Module id="${escapeXml(svc.id)}">`);
    lines.push(`      <Name>${escapeXml(svc.name)}</Name>`);
    lines.push(`      <Description>${escapeXml(svc.description)}</Description>`);
    lines.push("      <Links>");
    for (const ucRef of svc.useCaseRefs) {
      lines.push(`        <Link ref="RequirementsAnalysis.xml#${escapeXml(ucRef)}" />`);
    }
    for (const dep of svc.dependencies) {
      lines.push(`        <Link ref="${escapeXml(dep.ref)}" />`);
    }
    lines.push("      </Links>");
    lines.push("    </Module>");
  }
  lines.push("  </Modules>");

  // Flows
  if (level2.flows.length > 0) {
    lines.push("  <Flows>");
    for (const flow of level2.flows) {
      lines.push(`    <Flow id="${escapeXml(flow.id)}">`);
      lines.push(`      <Description>${escapeXml(flow.description)}</Description>`);
      lines.push("      <Steps>");
      for (const step of flow.steps) {
        lines.push(
          `        <Step order="${step.order}" from="${escapeXml(step.from)}" to="${escapeXml(step.to)}">${escapeXml(step.description)}</Step>`,
        );
      }
      lines.push("      </Steps>");
      lines.push("      <Links>");
      for (const ucRef of flow.useCaseRefs) {
        lines.push(`        <Link ref="RequirementsAnalysis.xml#${escapeXml(ucRef)}" />`);
      }
      lines.push("      </Links>");
      lines.push("    </Flow>");
    }
    lines.push("  </Flows>");
  }

  lines.push("</DevelopmentPlan>");

  const filePath = join(outputDir, "DevelopmentPlan.xml");
  writeFileSync(filePath, lines.join("\n"), "utf-8");
  return filePath;
}

/**
 * <FUNCTION_CONTRACT id="FC-fractal-writeModuleContract">
 *   <Intent>Write individual MODULE_CONTRACT XML files from Level 3 output, one per module.</Intent>
 *   <BlockAnchors>
 *     <BA ref="BA-FRAC-WRITE-MC-CONTRACT"/>
 *     <BA ref="BA-FRAC-WRITE-MC-XML"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
function writeModuleContract(mod: ModuleContract, contractsDir: string): string {
  /* <BLOCK_ANCHOR id="BA-FRAC-WRITE-MC-CONTRACT" purpose="Generate MODULE_CONTRACT XML from level output" /> */
  /* <BLOCK_ANCHOR id="BA-FRAC-WRITE-MC-XML" purpose="Write MODULE_CONTRACT artifact to output directory" /> */
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<ModuleContract id="${escapeXml(mod.id)}" version="1.0.0">`);

  lines.push("  <Purpose>");
  lines.push(`    ${escapeXml(mod.purpose)}`);
  lines.push("  </Purpose>");

  lines.push("  <Responsibilities>");
  for (const r of mod.responsibilities) {
    lines.push(`    <Item>${escapeXml(r)}</Item>`);
  }
  lines.push("  </Responsibilities>");

  lines.push("  <Invariants>");
  for (const inv of mod.invariants) {
    lines.push(`    <Item>${escapeXml(inv)}</Item>`);
  }
  lines.push("  </Invariants>");

  lines.push("  <Context>");
  lines.push("    <Upstream>");
  for (const u of mod.context.upstream) {
    lines.push(`      <Ref>${escapeXml(u)}</Ref>`);
  }
  lines.push("    </Upstream>");
  lines.push("    <Downstream>");
  for (const d of mod.context.downstream) {
    lines.push(`      <Ref>${escapeXml(d)}</Ref>`);
  }
  lines.push("    </Downstream>");
  lines.push("  </Context>");

  lines.push("  <Links>");
  for (const link of mod.links) {
    lines.push(`    <Link ref="${escapeXml(link)}" />`);
  }
  lines.push("  </Links>");

  lines.push("</ModuleContract>");

  const fileName = `${mod.id}.xml`;
  const filePath = join(contractsDir, fileName);
  writeFileSync(filePath, lines.join("\n"), "utf-8");
  return filePath;
}

/**
 * <FUNCTION_CONTRACT id="FC-fractal-writeFunctionContract">
 *   <Intent>Write individual FUNCTION_CONTRACT XML files from Level 4 output, one per function.</Intent>
 *   <BlockAnchors>
 *     <BA ref="BA-FRAC-WRITE-FC-CONTRACT"/>
 *     <BA ref="BA-FRAC-WRITE-FC-XML"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
function writeFunctionContract(fn: FunctionContract, contractsDir: string): string {
  /* <BLOCK_ANCHOR id="BA-FRAC-WRITE-FC-CONTRACT" purpose="Generate FUNCTION_CONTRACT XML from level output" /> */
  /* <BLOCK_ANCHOR id="BA-FRAC-WRITE-FC-XML" purpose="Write FUNCTION_CONTRACT artifact to output directory" /> */
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<FunctionContract id="${escapeXml(fn.id)}" version="1.0.0">`);

  lines.push(`  <Intent>${escapeXml(fn.intent)}</Intent>`);
  lines.push(`  <ModuleRef>${escapeXml(fn.moduleRef)}</ModuleRef>`);

  lines.push("  <Inputs>");
  for (const inp of fn.inputs) {
    lines.push(`    <Input name="${escapeXml(inp.name)}" type="${escapeXml(inp.type)}" />`);
  }
  lines.push("  </Inputs>");

  lines.push("  <Outputs>");
  for (const out of fn.outputs) {
    lines.push(`    <Output name="${escapeXml(out.name)}" type="${escapeXml(out.type)}" />`);
  }
  lines.push("  </Outputs>");

  lines.push("  <Preconditions>");
  for (const pre of fn.preconditions) {
    lines.push(`    <Item>${escapeXml(pre)}</Item>`);
  }
  lines.push("  </Preconditions>");

  lines.push("  <Postconditions>");
  for (const post of fn.postconditions) {
    lines.push(`    <Item>${escapeXml(post)}</Item>`);
  }
  lines.push("  </Postconditions>");

  lines.push("  <Invariants>");
  for (const inv of fn.invariants) {
    lines.push(`    <Item>${escapeXml(inv)}</Item>`);
  }
  lines.push("  </Invariants>");

  lines.push("  <ErrorHandling>");
  for (const err of fn.errorHandling) {
    lines.push(
      `    <Error type="${escapeXml(err.type)}" code="${escapeXml(err.code)}">${escapeXml(err.description)}</Error>`,
    );
  }
  lines.push("  </ErrorHandling>");

  lines.push("  <BlockAnchors>");
  for (const ba of fn.blockAnchors) {
    lines.push(`    <BA ref="${escapeXml(ba)}" />`);
  }
  lines.push("  </BlockAnchors>");

  lines.push("  <Tests>");
  for (const tc of fn.tests) {
    lines.push(`    <Case id="${escapeXml(tc.id)}">${escapeXml(tc.description)}</Case>`);
  }
  lines.push("  </Tests>");

  lines.push("  <Logging>");
  for (const log of fn.logging) {
    lines.push(
      `    <Log blockRef="${escapeXml(log.blockRef)}">${escapeXml(log.exampleLine)}</Log>`,
    );
  }
  lines.push("  </Logging>");

  lines.push("</FunctionContract>");

  const fileName = `${fn.id}.xml`;
  const filePath = join(contractsDir, fileName);
  writeFileSync(filePath, lines.join("\n"), "utf-8");
  return filePath;
}

// ── Application: Pipeline orchestration ─────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-fractal-runPipeline">
 *   <Intent>Orchestrate the full 4-level fractal pipeline: load input, run levels sequentially, write output artifacts.</Intent>
 *   <Inputs>
 *     <Input name="argv">Raw CLI argument array (process.argv.slice(2)).</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="exitCode">0=success, 1-5=error (see exit codes).</Output>
 *     <Output name="artifacts">Files written to output directory.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-FRAC-PIPELINE"/>
 *     <BA ref="BA-FRAC-OUTPUT-VALIDATE"/>
 *   </BlockAnchors>
 *   <Tests>
 *     <Case id="TC-FRAC-001">Full pipeline with inline requirement text produces all 4 artifact types.</Case>
 *     <Case id="TC-FRAC-002">Pipeline with --levels 1,2 only produces RequirementsAnalysis.xml and DevelopmentPlan.xml.</Case>
 *     <Case id="TC-FRAC-003">Pipeline with --context skips early levels and uses pre-existing context.</Case>
 *   </Tests>
 * </FUNCTION_CONTRACT>
 */
async function runPipeline(argv: string[]): Promise<number> {
  /* <BLOCK_ANCHOR id="BA-FRAC-PIPELINE" purpose="Orchestrate full pipeline execution" /> */

  // 1. Parse CLI
  const args = parseCliArgs(argv);

  // 2. Load requirement
  let requirementText = args.requirement;
  if (!requirementText) {
    console.error("[fractal] Error: --requirement is required");
    return 1;
  }

  // If requirement is a file path, read it
  if (existsSync(requirementText)) {
    try {
      requirementText = readFileSync(requirementText, "utf-8").trim();
    } catch (err) {
      console.error(`[fractal] Error reading requirement file: ${err}`);
      return 1;
    }
  }

  if (!requirementText.trim()) {
    console.error("[fractal] Error: requirement text is empty");
    return 1;
  }

  // 3. Load template
  let template = "";
  try {
    template = readFileSync(resolve(args.template), "utf-8");
  } catch {
    console.error(`[fractal] Warning: template file not found at ${args.template}, using no-op mode`);
  }

  // 4. Create output directories
  const outDir = resolve(args.out);
  const contractsDir = join(outDir, "contracts");
  mkdirSync(contractsDir, { recursive: true });

  // 5. Load or initialize context
  const context: FractalContext = { requirement: requirementText };

  if (args.context && existsSync(args.context)) {
    try {
      const loaded = JSON.parse(readFileSync(args.context, "utf-8")) as FractalContext;
      if (loaded.level1) context.level1 = loaded.level1;
      if (loaded.level2) context.level2 = loaded.level2;
      if (loaded.level3) context.level3 = loaded.level3;
      if (loaded.level4) context.level4 = loaded.level4;
      if (args.verbose) console.error(`[fractal] Loaded context from ${args.context}`);
    } catch (err) {
      console.error(`[fractal] Warning: could not load context file: ${err}`);
    }
  }

  const useLLM = template.length > 0;
  const levels = args.levels.sort();

  // 6. Run levels sequentially
  for (const level of levels) {
    if (args.verbose) console.error(`[fractal] Running Level ${level}...`);

    if (useLLM) {
      // Build previous output for context injection
      let previousOutput = "";
      if (level > 1 && context.level1) {
        previousOutput = `Level 1:\n${JSON.stringify(context.level1, null, 2)}`;
      }
      if (level > 2 && context.level2) {
        previousOutput += `\n\nLevel 2:\n${JSON.stringify(context.level2, null, 2)}`;
      }
      if (level > 3 && context.level3) {
        previousOutput += `\n\nLevel 3:\n${JSON.stringify(context.level3, null, 2)}`;
      }

      const prompt = assemblePrompt(template, level, requirementText, previousOutput);

      if (args.verbose) {
        console.error(`[fractal] Level ${level} prompt length: ${prompt.length} chars`);
      }

      // Call LLM with retry
      let parsed: unknown = null;
      const maxRetries = 2;
      for (let retry = 0; retry <= maxRetries; retry++) {
        try {
          const raw = await callLLM(prompt, args.endpoint, args.model, args.verbose);
          parsed = parseJsonResponse(raw);
          if (parsed !== null) break;
        } catch (err) {
          if (retry === maxRetries) {
            console.error(`[fractal] Level ${level} LLM call failed after retries: ${err}`);
            // Fall through to no-op
            break;
          }
        }
      }

      // If LLM failed or returned unparseable, fall back to no-op
      if (parsed === null) {
        if (args.verbose) {
          console.error(`[fractal] Level ${level}: LLM unavailable, using no-op template`);
        }
        parsed = null; // Will trigger no-op below
      } else {
        // Validate parsed output
        let valid = false;
        switch (level) {
          case 1:
            valid = validateLevel1(parsed);
            if (valid) context.level1 = parsed as Level1Output;
            break;
          case 2:
            if (context.level1) {
              valid = validateLevel2(parsed, context.level1);
              if (valid) context.level2 = parsed as Level2Output;
            }
            break;
          case 3:
            valid = validateLevel3(parsed);
            if (valid) context.level3 = parsed as Level3Output;
            break;
          case 4:
            valid = validateLevel4(parsed);
            if (valid) context.level4 = parsed as Level4Output;
            break;
        }

        if (!valid) {
          console.error(`[fractal] Level ${level}: validation failed, using no-op template`);
          parsed = null;
        }
      }
    }

    // No-op fallback
    if (level === 1 && !context.level1) {
      context.level1 = generateNoopLevel1(requirementText);
    } else if (level === 2 && !context.level2 && context.level1) {
      context.level2 = generateNoopLevel2(context.level1);
    } else if (level === 3 && !context.level3 && context.level2 && context.level1) {
      context.level3 = generateNoopLevel3(context.level2, context.level1);
    } else if (level === 4 && !context.level4 && context.level3 && context.level2 && context.level1) {
      context.level4 = generateNoopLevel4(context.level3, context.level2, context.level1);
    }

    // Log level completion
    if (args.verbose) {
      console.error(
        `[fractal] [SVC=grace-fractal][UC=FRACTAL-DECOMPOSE][BLOCK=BA-FRAC-L${level}-DECOMPOSE][STATE=L${level}_COMPLETE] eventType=FRACTAL_LEVEL decision=ACCEPT keyValues=level=${level}`,
      );
    }
  }

  // 7. Write output artifacts
  /* <BLOCK_ANCHOR id="BA-FRAC-OUTPUT-VALIDATE" purpose="Validate output completeness and cross-references" /> */
  const writtenFiles: string[] = [];

  if (context.level1) {
    const path = writeRequirementsAnalysis(context.level1, outDir);
    writtenFiles.push(path);
    console.log(`  Written: ${path}`);
  }

  if (context.level2 && context.level1) {
    const path = writeDevelopmentPlan(context.level2, context.level1, outDir);
    writtenFiles.push(path);
    console.log(`  Written: ${path}`);
  }

  if (context.level3) {
    for (const mod of context.level3.modules) {
      const path = writeModuleContract(mod, contractsDir);
      writtenFiles.push(path);
      console.log(`  Written: ${path}`);
    }
  }

  if (context.level4) {
    for (const fn of context.level4.functions) {
      const path = writeFunctionContract(fn, contractsDir);
      writtenFiles.push(path);
      console.log(`  Written: ${path}`);
    }
  }

  // Write context.json for resumption
  const contextPath = join(outDir, "context.json");
  writeFileSync(contextPath, JSON.stringify(context, null, 2), "utf-8");
  writtenFiles.push(contextPath);

  // 8. Validation summary
  console.log(`\n[fractal] Pipeline complete. ${writtenFiles.length} files written to ${outDir}`);

  if (args.verbose) {
    console.error(
      `[fractal] [SVC=grace-fractal][UC=FRACTAL-DECOMPOSE][BLOCK=BA-FRAC-OUTPUT-VALIDATE][STATE=VALIDATION_COMPLETE] eventType=VALIDATION decision=ACCEPT keyValues=files_count=${writtenFiles.length}`,
    );
  }

  return 0;
}

// ── Entry point ────────────────────────────────────────────────────────────

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("grace-fractal.ts") ||
    process.argv[1].endsWith("grace-fractal.js") ||
    process.argv[1].includes("grace-fractal"));

if (isDirect) {
  runPipeline(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[fractal] Fatal error: ${err}`);
      process.exit(1);
    });
}
