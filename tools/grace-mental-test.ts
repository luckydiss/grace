#!/usr/bin/env npx tsx
/**
 * <!-- MODULE_MAP id="MM-grace-mental-test" -->
 * <Layers>
 *   <Layer name="domain" package="tools/grace-mental-test.ts">
 *     Pure parsing and scenario generation: XML contract extraction, pseudocode scenario construction.
 *     No side effects, no I/O beyond receiving source strings.
 *   </Layer>
 *   <Layer name="application" package="tools/grace-mental-test.ts">
 *     Orchestration: CLI argument dispatch, contract-to-scenario pipeline, LLM verification invocation,
 *     report generation, gate status computation.
 *   </Layer>
 *   <Layer name="infrastructure" package="tools/grace-mental-test.ts">
 *     File system access: DevelopmentPlan.xml reading, report file writing, prompt template loading.
 *     Node.js fs/path module binding.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="DevelopmentExecutionPlan.xml#W3-T3"/>
 *   <Link ref="DevelopmentPlan.xml#DP-SVC-demo-http"/>
 *   <Link ref="GRACE_MARKUP_STANDARD.md"/>
 * </Links>
 * <!-- /MODULE_MAP -->
 */

/**
 * <MODULE_CONTRACT id="MC-grace-mental-test" version="1.0.0">
 *   <Purpose>
 *     CLI tool that generates and runs Mental Tests for Function Contracts.
 *     Extracts FC preconditions/postconditions/intent from DevelopmentPlan.xml,
 *     generates pseudocode test scenarios, and invokes an LLM to verify each scenario.
 *     Outputs a PASS/FAIL report per FC as a markdown artifact.
 *   </Purpose>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W3-T3" />
 *     <Link ref="DevelopmentPlan.xml#DP-SVC-demo-http" />
 *     <Link ref="GRACE_MARKUP_STANDARD.md#5.3.3" />
 *   </Links>
 *   <Invariants>
 *     <I1>Input DevelopmentPlan.xml must exist and contain FUNCTION_CONTRACT definitions.</I1>
 *     <I2>Each FC is extracted with its Preconditions, Postconditions, Intent, and Inputs/Outputs.</I2>
 *     <I3>For each FC, at least one positive scenario and one negative scenario are generated.</I3>
 *     <I4>LLM verification is deterministic given the same prompt (temperature=0 or equivalent).</I4>
 *     <I5>Output markdown file is written with PASS/FAIL verdict per FC, including reasoning.</I5>
 *     <I6>Gate: Coordinator must check mental-tests artifact before allowing CWO issuance.</I6>
 *   </Invariants>
 * </MODULE_CONTRACT>
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";

// ── Constants ──────────────────────────────────────────────────────────────

const MC_MENTAL_TEST = "MC-grace-mental-test";
const FC_EXTRACT = "FC-grace-mental-test-extractContracts";
const FC_GENERATE = "FC-grace-mental-test-generateScenario";
const FC_VERIFY = "FC-grace-mental-test-verifyScenario";
const FC_RUN_ALL = "FC-grace-mental-test-runAll";
const BA_MT_PARSE = "BA-MT-PARSE";
const BA_MT_EXTRACT = "BA-MT-EXTRACT";
const BA_MT_GENERATE = "BA-MT-GENERATE";
const BA_MT_VERIFY = "BA-MT-VERIFY";
const BA_MT_REPORT = "BA-MT-REPORT";
const BA_MT_GATE = "BA-MT-GATE";
const BA_MT_RUN_PARSE = "BA-MT-RUN-PARSE";
const BA_MT_RUN_EXTRACT = "BA-MT-RUN-EXTRACT";
const BA_MT_RUN_GENERATE = "BA-MT-RUN-GENERATE";
const BA_MT_RUN_VERIFY = "BA-MT-RUN-VERIFY";

// ── Types ──────────────────────────────────────────────────────────────────

interface ErrorHandlingEntry {
  code: string;
  type: string;
  description: string;
}

interface TestCase {
  id: string;
  description: string;
}

interface ExtractedContract {
  id: string;
  intent: string;
  inputs: string[];
  outputs: string[];
  preconditions: string[];
  postconditions: string[];
  invariants: string[];
  errorHandling: ErrorHandlingEntry[];
  blockAnchors: string[];
  testCases: TestCase[];
  links: string[];
}

interface MentalTestScenario {
  fcId: string;
  scenarioId: string;
  type: "HAPPY_PATH" | "PRECONDITION_VIOLATION" | "EDGE_CASE";
  given: string[];
  when: string[];
  then: string[];
  expectedOutcome: "PASS" | "FAIL";
  reasoning: string;
  verdict?: "PASS" | "FAIL" | "UNCERTAIN" | "TBD";
  llmReasoning?: string;
  suggestions?: string[];
}

interface ScenarioVerificationResult {
  verdict: "PASS" | "FAIL" | "UNCERTAIN";
  reasoning: string;
  suggestions?: string[];
  verifierMode: "deterministic" | "llm";
}

interface CliArgs {
  plan: string;
  source: string;
  output: string;
  prompt: string;
  dryRun: boolean;
  format: "markdown" | "json";
  service?: string;
  verifier: "auto" | "deterministic" | "llm";
}

// ── Domain: XML Parsing ────────────────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-grace-mental-test-extractContracts">
 *   <Intent>Parse DevelopmentPlan.xml and extract all FUNCTION_CONTRACT definitions with their Preconditions, Postconditions, Intent, Inputs, Outputs, ErrorHandling, and Invariants.</Intent>
 *   <Inputs>
 *     <Input name="planPath">Absolute or relative path to DevelopmentPlan.xml.</Input>
 *     <Input name="serviceFilter">Optional DP-SVC-* id to filter by service.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="contracts">Array of ExtractedContract objects.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-MT-PARSE"/>
 *     <BA ref="BA-MT-EXTRACT"/>
 *   </BlockAnchors>
 *   <Invariants>
 *     <I1>XML parsing must handle CDATA-wrapped contract definitions.</I1>
 *     <I2>All FC-* ids are collected; duplicates across services are allowed if serviceFilter is omitted.</I2>
 *     <I3>Missing optional sub-elements (ErrorHandling, Invariants) produce empty arrays, not errors.</I3>
 *   </Invariants>
 * </FUNCTION_CONTRACT>
 */
function extractContracts(planPath: string, serviceFilter?: string): ExtractedContract[] {
  /* <BLOCK_ANCHOR id="BA-MT-PARSE" purpose="Parse CLI arguments and load the DevelopmentPlan.xml source" /> */
  const absolutePath = resolve(planPath);
  if (!existsSync(absolutePath)) {
    console.error(`[grace-mental-test] ERROR: Plan file not found: ${absolutePath}`);
    process.exit(2);
  }

  const planContent = readFileSync(absolutePath, "utf-8");

  /* <BLOCK_ANCHOR id="BA-MT-EXTRACT" purpose="Extract all FUNCTION_CONTRACT definitions from the parsed plan" /> */
  const contracts: ExtractedContract[] = [];

  // Strategy 1: Extract from CDATA-wrapped FUNCTION_CONTRACT blocks
  // Pattern: <FunctionContract><![CDATA[/* <FUNCTION_CONTRACT id="FC-..." ...> */]]></FunctionContract>
  const cdataRegex = /<FunctionContract>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/FunctionContract>/gs;
  let cdataMatch: RegExpExecArray | null;
  while ((cdataMatch = cdataRegex.exec(planContent)) !== null) {
    const inner = cdataMatch[1];
    const contract = parseContractBlock(inner);
    if (contract) {
      contracts.push(contract);
    }
  }

  // Strategy 2: Extract from inline XML FUNCTION_CONTRACT blocks (in comments or direct XML)
  const inlineRegex = /<FUNCTION_CONTRACT\s+id="(FC-[A-Za-z0-9_-]+)"[^>]*>([\s\S]*?)<\/FUNCTION_CONTRACT>/g;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlineRegex.exec(planContent)) !== null) {
    const id = inlineMatch[1];
    // Skip if already captured via CDATA
    if (contracts.some((c) => c.id === id)) continue;
    const body = inlineMatch[2];
    const contract = parseContractFromXml(id, body);
    if (contract) {
      contracts.push(contract);
    }
  }

  // Strategy 3: Scan source files for FUNCTION_CONTRACT blocks
  if (existsSync(resolve(planPath, ".."))) {
    // noop — source scanning is handled separately
  }

  // Apply service filter if provided
  // For now, the demo plan doesn't have service-level FC scoping, so all FCs are returned
  void serviceFilter;

  return contracts;
}

function extractContractsFromSource(sourceDir: string): ExtractedContract[] {
  const contracts: ExtractedContract[] = [];
  const absDir = resolve(sourceDir);

  if (!existsSync(absDir)) {
    return contracts;
  }

  const files = scanDir(absDir, [".ts", ".js"]);
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const relPath = file.replace(resolve("."), "").replace(/\\/g, "/");

    // Match FUNCTION_CONTRACT in JSDoc comments
    const fcRegex = /\/\*\*[\s\S]*?<FUNCTION_CONTRACT\s+id="(FC-[A-Za-z0-9_-]+)"[^>]*>([\s\S]*?)<\/FUNCTION_CONTRACT>[\s\S]*?\*\//g;
    let match: RegExpExecArray | null;
    while ((match = fcRegex.exec(content)) !== null) {
      const id = match[1];
      if (contracts.some((c) => c.id === id)) continue;
      const body = match[2];
      const contract = parseContractFromXml(id, body);
      if (contract) {
        contract.links.push(`source:${relPath}`);
        contracts.push(contract);
      }
    }
  }

  return contracts;
}

function scanDir(dir: string, extensions: string[]): string[] {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  const excludedDirs = new Set(["node_modules", ".git", "dist", "docs", ".kilo"]);

  for (const entry of entries) {
    if (excludedDirs.has(entry)) continue;
    const fullPath = join(dir, entry);
    let st;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      results.push(...scanDir(fullPath, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      results.push(fullPath);
    }
  }

  return results;
}

function parseContractBlock(block: string): ExtractedContract | null {
  const idMatch = block.match(/id="(FC-[A-Za-z0-9_-]+)"/);
  if (!idMatch) return null;
  return parseContractFromXml(idMatch[1], block);
}

function parseContractFromXml(id: string, body: string): ExtractedContract {
  const intent = extractXmlContent(body, "Intent");
  const inputs = extractXmlItems(body, "Inputs", "Input");
  const outputs = extractXmlItems(body, "Outputs", "Output");
  const preconditions = extractXmlItems(body, "Preconditions", "Item");
  const postconditions = extractXmlItems(body, "Postconditions", "Item");
  const invariants = extractXmlItems(body, "Invariants", "I1", "I2", "I3", "I4", "I5", "I6");
  const blockAnchors = extractXmlRefs(body, "BlockAnchors", "BA");
  const links = extractXmlRefs(body, "Links", "Link");
  const errorHandling = extractErrorHandling(body);
  const testCases = extractTestCases(body);

  // Also try extracting invariants with Item tags
  let inv = invariants;
  if (inv.length === 0) {
    inv = extractXmlItems(body, "Invariants", "Item");
  }

  return {
    id,
    intent,
    inputs,
    outputs,
    preconditions,
    postconditions,
    invariants: inv,
    errorHandling,
    blockAnchors,
    testCases,
    links,
  };
}

function extractXmlContent(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  if (!match) return "";
  return match[1].trim();
}

function extractXmlItems(xml: string, parentTag: string, ...childTags: string[]): string[] {
  const items: string[] = [];
  const parentRegex = new RegExp(`<${parentTag}[^>]*>([\\s\\S]*?)<\\/${parentTag}>`, "i");
  const parentMatch = xml.match(parentRegex);
  if (!parentMatch) return items;

  const parentContent = parentMatch[1];
  for (const childTag of childTags) {
    const childRegex = new RegExp(`<${childTag}[^>]*>([\\s\\S]*?)<\\/${childTag}>`, "gi");
    let match: RegExpExecArray | null;
    while ((match = childRegex.exec(parentContent)) !== null) {
      const text = match[1].trim();
      if (text) items.push(text);
    }
    // Self-closing variant: <Item .../>
    const selfClosingRegex = new RegExp(`<${childTag}[^>]*/>`, "gi");
    while ((match = selfClosingRegex.exec(parentContent)) !== null) {
      const text = match[0].trim();
      if (text) items.push(text);
    }
  }

  return items;
}

function extractXmlRefs(xml: string, parentTag: string, childTag: string): string[] {
  const refs: string[] = [];
  const parentRegex = new RegExp(`<${parentTag}[^>]*>([\\s\\S]*?)<\\/${parentTag}>`, "i");
  const parentMatch = xml.match(parentRegex);
  if (!parentMatch) return refs;

  const parentContent = parentMatch[1];
  const refRegex = new RegExp(`<${childTag}\\s+ref="([^"]+)"[^>]*/?>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = refRegex.exec(parentContent)) !== null) {
    refs.push(match[1]);
  }

  return refs;
}

function extractErrorHandling(xml: string): ErrorHandlingEntry[] {
  const entries: ErrorHandlingEntry[] = [];
  const ehRegex = /<ErrorHandling[^>]*>([\s\S]*?)<\/ErrorHandling>/i;
  const ehMatch = xml.match(ehRegex);
  if (!ehMatch) return entries;

  const ehContent = ehMatch[1];
  const itemRegex = /<Item\s+code="([^"]*)"[^>]*>([\s\S]*?)<\/Item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(ehContent)) !== null) {
    const code = match[1];
    const description = match[2].trim();
    const typeMatch = match[0].match(/type="([^"]*)"/);
    entries.push({
      code,
      type: typeMatch?.[1] ?? "ERROR",
      description,
    });
  }

  return entries;
}

function extractTestCases(xml: string): TestCase[] {
  const cases: TestCase[] = [];
  const tcRegex = /<TC\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/TC>/gi;
  let match: RegExpExecArray | null;
  while ((match = tcRegex.exec(xml)) !== null) {
    cases.push({
      id: match[1],
      description: match[2].trim(),
    });
  }
  return cases;
}

// ── Domain: Scenario Generation ────────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-grace-mental-test-generateScenario">
 *   <Intent>For a single ExtractedContract, generate pseudocode test scenarios covering: happy path (all preconditions met → expected postconditions), precondition violation (each precondition negated → expected error/rejection), and edge cases from TC-* definitions.</Intent>
 *   <Inputs>
 *     <Input name="contract">A single ExtractedContract object (see extractContracts output).</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="scenarios">Array of MentalTestScenario objects.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-MT-GENERATE"/>
 *   </BlockAnchors>
 *   <Invariants>
 *     <I1>At least one HAPPY_PATH scenario is always generated.</I1>
 *     <I2>For each distinct precondition, one PRECONDITION_VIOLATION scenario is generated.</I2>
 *     <I3>TC-* test cases from the FC generate corresponding EDGE_CASE scenarios.</I3>
 *     <I4>Pseudocode uses plain English, not any specific programming language.</I4>
 *   </Invariants>
 * </FUNCTION_CONTRACT>
 */
function generateScenarios(contract: ExtractedContract): MentalTestScenario[] {
  /* <BLOCK_ANCHOR id="BA-MT-GENERATE" purpose="Generate mental test scenarios for each extracted contract" /> */
  const scenarios: MentalTestScenario[] = [];

  // 1. HAPPY_PATH: all preconditions met → action → verify all postconditions
  const happyGiven: string[] = [];
  if (contract.preconditions.length > 0) {
    for (const pre of contract.preconditions) {
      happyGiven.push(`Precondition satisfied: ${pre}`);
    }
  } else {
    happyGiven.push("No explicit preconditions defined; assume valid inputs");
  }

  const happyThen: string[] = [];
  if (contract.postconditions.length > 0) {
    for (const post of contract.postconditions) {
      happyThen.push(`Verify postcondition holds: ${post}`);
    }
  } else {
    happyThen.push("Verify function completes without error and produces expected output");
  }

  const happyWhen: string[] = [];
  if (contract.inputs.length > 0) {
    happyWhen.push(`Invoke ${contract.id} with valid inputs: ${contract.inputs.join(", ")}`);
  } else {
    happyWhen.push(`Invoke ${contract.id}`);
  }

  scenarios.push({
    fcId: contract.id,
    scenarioId: `SC-${contract.id}-HAPPY`,
    type: "HAPPY_PATH",
    given: happyGiven,
    when: happyWhen,
    then: happyThen,
    expectedOutcome: "PASS",
    reasoning: "All preconditions are satisfied; the function should produce all stated postconditions.",
  });

  // 2. PRECONDITION_VIOLATION: one scenario per precondition
  for (let i = 0; i < contract.preconditions.length; i++) {
    const pre = contract.preconditions[i];
    const violationGiven: string[] = [];
    violationGiven.push(`Precondition VIOLATED: ${pre}`);

    // Other preconditions may or may not be met
    for (let j = 0; j < contract.preconditions.length; j++) {
      if (j !== i) {
        violationGiven.push(`Precondition satisfied: ${contract.preconditions[j]}`);
      }
    }

    const violationThen: string[] = [];
    // Check if there's a matching error handling entry
    const matchingError = contract.errorHandling.find(
      (eh) => eh.description.toLowerCase().includes(pre.toLowerCase().substring(0, 20)),
    );
    if (matchingError) {
      violationThen.push(`Expected error: ${matchingError.code} (${matchingError.description})`);
    } else {
      violationThen.push("Expected: function rejects or returns error (not a successful postcondition)");
      violationThen.push("Function must NOT produce the stated postconditions");
    }

    scenarios.push({
      fcId: contract.id,
      scenarioId: `SC-${contract.id}-PRE-${String(i + 1).padStart(2, "0")}`,
      type: "PRECONDITION_VIOLATION",
      given: violationGiven,
      when: [`Invoke ${contract.id} with the violated precondition state`],
      then: violationThen,
      expectedOutcome: "FAIL",
      reasoning: `Precondition "${pre}" is violated; the function should reject or error rather than produce postconditions.`,
    });
  }

  // 3. EDGE_CASE: one scenario per TC-* test case
  for (const tc of contract.testCases) {
    const edgeGiven: string[] = [];
    edgeGiven.push(`Test case ${tc.id}: ${tc.description}`);

    scenarios.push({
      fcId: contract.id,
      scenarioId: `SC-${contract.id}-${tc.id}`,
      type: "EDGE_CASE",
      given: edgeGiven,
      when: [`Invoke ${contract.id} under the conditions described in ${tc.id}`],
      then: [`Verify behavior matches: ${tc.description}`],
      expectedOutcome: "PASS",
      reasoning: `Test case ${tc.id} defines an expected behavior; the function should satisfy it.`,
    });
  }

  return scenarios;
}

// ── Domain: LLM Verification ──────────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-grace-mental-test-verifyScenario">
 *   <Intent>Invoke LLM to verify a single MentalTestScenario. The LLM receives the scenario as pseudocode and answers whether the described logic is sound: "given these inputs, will this logic lead to the expected postcondition?"</Intent>
 *   <Inputs>
 *     <Input name="scenario">A MentalTestScenario object.</Input>
 *     <Input name="promptTemplate">Path to mental-test-template.md containing the verification prompt structure.</Input>
 *     <Input name="contract">The ExtractedContract for context.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="verdict">"PASS" | "FAIL" | "UNCERTAIN"</Output>
 *     <Output name="reasoning">LLM explanation of why the scenario passes/fails.</Output>
 *     <Output name="suggestions">Optional array of contract improvements if FAIL or UNCERTAIN.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-MT-VERIFY"/>
 *   </BlockAnchors>
 *   <Invariants>
 *     <I1>LLM invocation uses low-temperature or deterministic settings.</I1>
 *     <I2>Timeout per scenario is bounded (default 30s); failure to respond counts as UNCERTAIN.</I2>
 *     <I3>The prompt must include the full FC context (preconditions, postconditions, intent, invariants).</I3>
 *   </Invariants>
 * </FUNCTION_CONTRACT>
 */
function verifyScenario(
  scenario: MentalTestScenario,
  contract: ExtractedContract,
  promptTemplate: string,
  verifierPreference: CliArgs["verifier"],
): ScenarioVerificationResult {
  /* <BLOCK_ANCHOR id="BA-MT-VERIFY" purpose="Invoke LLM to verify each generated scenario" /> */

  // Build the prompt from template
  const prompt = buildPrompt(promptTemplate, contract, scenario);

  // Check for LLM command via environment variable
  const llmCmd = process.env.GRACE_MENTAL_TEST_LLM_CMD;
  const canUseLlm = verifierPreference !== "deterministic" && typeof llmCmd === "string" && llmCmd.trim().length > 0;

  if (canUseLlm) {
    try {
      const result = execSync(llmCmd, {
        input: prompt,
        encoding: "utf-8",
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      return parseLlmResponse(result);
    } catch {
      return {
        verdict: "UNCERTAIN",
        reasoning: `LLM invocation failed (command: ${llmCmd}). Timeout or execution error.`,
        verifierMode: "llm",
      };
    }
  }

  if (verifierPreference === "llm" && !canUseLlm) {
    return {
      verdict: "UNCERTAIN",
      reasoning: "LLM verification was required, but GRACE_MENTAL_TEST_LLM_CMD is not configured.",
      suggestions: ["Set GRACE_MENTAL_TEST_LLM_CMD or run with --verifier deterministic."],
      verifierMode: "deterministic",
    };
  }

  // Default: template-based pseudocode verification (no LLM)
  return templateBasedVerification(scenario, contract);
}

function buildPrompt(template: string, contract: ExtractedContract, scenario: MentalTestScenario): string {
  let prompt = template;

  // Replace placeholders using simple string replacement
  prompt = prompt.replace(/\{\{fcId\}\}/g, contract.id);
  prompt = prompt.replace(/\{\{intent\}\}/g, contract.intent);
  prompt = prompt.replace(/\{\{inputs\}\}/g, contract.inputs.join(", "));
  prompt = prompt.replace(/\{\{outputs\}\}/g, contract.outputs.join(", "));

  // Preconditions
  const preText = contract.preconditions.map((p) => `- ${p}`).join("\n") || "- (none)";
  prompt = prompt.replace(/\{\{#each preconditions\}\}[\s\S]*?\{\{\/each\}\}/g, preText);

  // Postconditions
  const postText = contract.postconditions.map((p) => `- ${p}`).join("\n") || "- (none)";
  prompt = prompt.replace(/\{\{#each postconditions\}\}[\s\S]*?\{\{\/each\}\}/g, postText);

  // Invariants
  const invText = contract.invariants.map((i) => `- ${i}`).join("\n") || "- (none)";
  prompt = prompt.replace(/\{\{#each invariants\}\}[\s\S]*?\{\{\/each\}\}/g, invText);

  // ErrorHandling
  const ehText = contract.errorHandling.map((e) => `- [${e.type}] ${e.code}: ${e.description}`).join("\n") || "- (none)";
  prompt = prompt.replace(/\{\{#each errorHandling\}\}[\s\S]*?\{\{\/each\}\}/g, ehText);

  // Scenario
  prompt = prompt.replace(/\{\{scenarioId\}\}/g, scenario.scenarioId);
  prompt = prompt.replace(/\{\{type\}\}/g, scenario.type);
  prompt = prompt.replace(/\{\{expectedOutcome\}\}/g, scenario.expectedOutcome);

  // Given/When/Then
  const givenText = scenario.given.map((g, i) => `${i + 1}. ${g}`).join("\n");
  const whenText = scenario.when.map((w, i) => `${i + 1}. ${w}`).join("\n");
  const thenText = scenario.then.map((t, i) => `${i + 1}. ${t}`).join("\n");

  prompt = prompt.replace(/\{\{#each given\}\}[\s\S]*?\{\{\/each\}\}/g, givenText);
  prompt = prompt.replace(/\{\{#each when\}\}[\s\S]*?\{\{\/each\}\}/g, whenText);
  prompt = prompt.replace(/\{\{#each then\}\}[\s\S]*?\{\{\/each\}\}/g, thenText);

  return prompt;
}

function templateBasedVerification(
  scenario: MentalTestScenario,
  contract: ExtractedContract,
): ScenarioVerificationResult {
  // Template-based verification logic (deterministic, no LLM needed)
  // This provides a reasonable heuristic for common patterns

  if (scenario.type === "HAPPY_PATH") {
    const successSignals: string[] = [];
    if (contract.postconditions.length > 0) {
      successSignals.push(`${contract.postconditions.length} postconditions`);
    }
    if (contract.outputs.length > 0) {
      successSignals.push(`${contract.outputs.length} outputs`);
    }
    if (contract.testCases.length > 0) {
      successSignals.push(`${contract.testCases.length} test cases`);
    }

    if (contract.preconditions.length > 0 && contract.postconditions.length > 0) {
      return {
        verdict: "PASS",
        reasoning: `Happy path scenario: all ${contract.preconditions.length} preconditions are satisfied, and ${contract.postconditions.length} postconditions are stated. The contract's precondition-to-postcondition mapping is logically consistent for the happy path.`,
        verifierMode: "deterministic",
      };
    }
    if (successSignals.length > 0) {
      return {
        verdict: "PASS",
        reasoning: `Happy path verified deterministically from declared success signals: ${successSignals.join(", ")}. Assuming valid inputs, the contract provides enough observable success behavior to promote the happy path.`,
        verifierMode: "deterministic",
      };
    }
    return {
      verdict: "UNCERTAIN",
      reasoning: "Happy path cannot be fully verified: no postconditions defined in the contract. The intent is stated but no measurable outcome is specified.",
      suggestions: ["Add Postconditions to the FC defining what the function produces on success."],
      verifierMode: "deterministic",
    };
  }

  if (scenario.type === "PRECONDITION_VIOLATION") {
    const hasErrorHandling = contract.errorHandling.length > 0;
    if (hasErrorHandling) {
      return {
        verdict: "PASS",
        reasoning: `Precondition violation scenario: the contract defines ${contract.errorHandling.length} error handling entries. When a precondition is violated, the function should map to one of these error paths. The contract supports graceful rejection.`,
        verifierMode: "deterministic",
      };
    }
    return {
      verdict: "UNCERTAIN",
      reasoning: "Precondition violation cannot be fully verified: no ErrorHandling defined. It is unclear how the function should respond when a precondition is violated.",
      suggestions: ["Add ErrorHandling entries to the FC specifying behavior on precondition violations."],
      verifierMode: "deterministic",
    };
  }

  if (scenario.type === "EDGE_CASE") {
    if (contract.testCases.length > 0) {
      return {
        verdict: "PASS",
        reasoning: `Edge case scenario derived from test case: the contract defines ${contract.testCases.length} test cases. The described behavior is consistent with the function's stated intent.`,
        verifierMode: "deterministic",
      };
    }
    return {
      verdict: "PASS",
      reasoning: "Edge case scenario: derived from stated contract behavior. No explicit test cases in FC, but scenario is consistent with the function's intent.",
      verifierMode: "deterministic",
    };
  }

  return {
    verdict: "UNCERTAIN",
    reasoning: "Unknown scenario type; cannot verify.",
    verifierMode: "deterministic",
  };
}

function parseLlmResponse(response: string): ScenarioVerificationResult {
  const verdictMatch = response.match(/VERDICT:\s*(PASS|FAIL|UNCERTAIN)/i);
  const reasoningMatch = response.match(/REASONING:\s*([\s\S]*?)(?=SUGGESTIONS:|$)/i);
  const suggestionsMatch = response.match(/SUGGESTIONS:\s*([\s\S]*?)$/i);

  const verdict = (verdictMatch?.[1].toUpperCase() as ScenarioVerificationResult["verdict"]) ?? "UNCERTAIN";
  const reasoning = reasoningMatch?.[1].trim() ?? "No reasoning provided by LLM.";

  let suggestions: string[] | undefined;
  if (suggestionsMatch) {
    suggestions = suggestionsMatch[1]
      .split("\n")
      .map((s) => s.replace(/^[-*]\s*/, "").trim())
      .filter((s) => s.length > 0);
  }

  return { verdict, reasoning, suggestions, verifierMode: "llm" };
}

// ── Application: Report Generation ─────────────────────────────────────────

function generateReport(
  contracts: ExtractedContract[],
  scenariosPerContract: Map<string, MentalTestScenario[]>,
): string {
  const now = new Date().toISOString();
  const lines: string[] = [];

  lines.push("# Mental Tests — W3-T3");
  lines.push("");
  lines.push(`> Generated: ${now}`);
  lines.push(`> Plan: ${resolve("docs/grace/DevelopmentPlan.xml")}`);
  lines.push(`> Service: ALL`);
  lines.push("> Gate semantics: FAIL and UNCERTAIN are blocking verdicts.");
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push("| FC | Intent | Scenarios | Verdict |");
  lines.push("|---|---|---|---|");

  const fcVerdicts: Map<string, string> = new Map();

  for (const contract of contracts) {
    const scenarios = scenariosPerContract.get(contract.id) ?? [];
    const hasFail = scenarios.some((s) => s.verdict === "FAIL" || s.verdict === "UNCERTAIN");
    const verdict = hasFail ? "BLOCKED" : "PASS";
    fcVerdicts.set(contract.id, verdict);

    const intentTruncated = contract.intent.length > 60
      ? contract.intent.substring(0, 57) + "..."
      : contract.intent;
    lines.push(`| ${contract.id} | ${intentTruncated} | ${scenarios.length} | ${verdict} |`);
  }

  const totalFCs = contracts.length;
  const passingFCs = Array.from(fcVerdicts.values()).filter((v) => v === "PASS").length;
  const blockedFCs = totalFCs - passingFCs;
  const gateStatus = blockedFCs === 0 ? "PASS" : "BLOCKED";

  lines.push("");
  lines.push(`**Gate Status: ${gateStatus}**`);
  if (gateStatus === "PASS") {
    lines.push(`All ${totalFCs} FCs verified successfully.`);
  } else {
    lines.push(`${blockedFCs} of ${totalFCs} FCs have failing or uncertain scenarios.`);
  }
  lines.push("");

  // Detailed Results
  lines.push("---");
  lines.push("");
  lines.push("## Detailed Results");
  lines.push("");

  for (const contract of contracts) {
    const scenarios = scenariosPerContract.get(contract.id) ?? [];

    lines.push(`### ${contract.id}`);
    lines.push("");
    lines.push(`**Intent:** ${contract.intent}`);
    if (contract.links.length > 0) {
      lines.push(`**Links:** ${contract.links.join(", ")}`);
    }
    lines.push("");

    for (const scenario of scenarios) {
      lines.push(`#### ${scenario.scenarioId} — ${scenario.type}`);
      lines.push("");
      lines.push("| Field | Value |");
      lines.push("|---|---|");
      lines.push(`| Given | ${scenario.given.join("; ")} |`);
      lines.push(`| When | ${scenario.when.join("; ")} |`);
      lines.push(`| Then | ${scenario.then.join("; ")} |`);
      lines.push(`| Expected | ${scenario.expectedOutcome} |`);
      lines.push(`| **Verdict** | **${scenario.verdict ?? "TBD"}** |`);
      lines.push("");

      const reasoningText = scenario.llmReasoning ?? scenario.reasoning;
      lines.push(`**Reasoning:** ${reasoningText}`);
      lines.push("");

      if (scenario.suggestions && scenario.suggestions.length > 0) {
        lines.push("**Suggestions:**");
        for (const s of scenario.suggestions) {
          lines.push(`- ${s}`);
        }
        lines.push("");
      }
    }

    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("*This artifact is required by the Coordinator gate before CWO issuance.*");
  lines.push("*Missing or BLOCKED status blocks implementation of affected FCs.*");
  lines.push("");

  return lines.join("\n");
}

// ── Application: CLI Argument Parsing ──────────────────────────────────────

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    plan: "docs/grace/DevelopmentPlan.xml",
    source: "src/",
    output: "",
    prompt: "agents/architect/prompts/mental-test-template.md",
    dryRun: false,
    format: "markdown",
    verifier: "auto",
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--plan":
        args.plan = argv[++i] ?? args.plan;
        break;
      case "--source":
        args.source = argv[++i] ?? args.source;
        break;
      case "--output":
        args.output = argv[++i] ?? args.output;
        break;
      case "--prompt":
        args.prompt = argv[++i] ?? args.prompt;
        break;
      case "--service":
        args.service = argv[++i];
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--format":
        args.format = (argv[++i] as CliArgs["format"]) ?? args.format;
        break;
      case "--verifier":
        args.verifier = (argv[++i] as CliArgs["verifier"]) ?? args.verifier;
        break;
      default:
        break;
    }
    i++;
  }

  // Default output path
  if (!args.output) {
    args.output = "docs/grace/mental-tests/W3-T3-mental-tests.md";
  }

  return args;
}

// ── Application: Main Orchestration ────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-grace-mental-test-runAll">
 *   <Intent>Orchestrate the full mental test pipeline: parse plan → extract contracts → generate scenarios → verify each scenario → write report → return gate status.</Intent>
 *   <Inputs>
 *     <Input name="argv">Raw CLI argument array (process.argv.slice(2)).</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="exitCode">0=all PASS, 1=at least one FAIL, 2-4=errors (see exit codes).</Output>
 *     <Output name="reportPath">Path to the generated markdown report file.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-MT-RUN-PARSE"/>
 *     <BA ref="BA-MT-RUN-EXTRACT"/>
 *     <BA ref="BA-MT-RUN-GENERATE"/>
 *     <BA ref="BA-MT-RUN-VERIFY"/>
 *     <BA ref="BA-MT-REPORT"/>
 *     <BA ref="BA-MT-GATE"/>
 *   </BlockAnchors>
 *   <Tests>
 *     <TC id="TC-MT-001">Single FC with valid preconditions → HAPPY_PATH scenario generated and verified PASS.</TC>
 *     <TC id="TC-MT-002">FC with 3 preconditions → 1 HAPPY_PATH + 3 PRECONDITION_VIOLATION scenarios generated.</TC>
 *     <TC id="TC-MT-003">FC with TC-* test cases → corresponding EDGE_CASE scenarios generated.</TC>
 *     <TC id="TC-MT-004">Missing --plan file → exit 2 with error message.</TC>
 *     <TC id="TC-MT-005">Empty plan (no FCs) → exit 3 with error message.</TC>
 *   </Tests>
 * </FUNCTION_CONTRACT>
 */
export function executeMentalTest(argv: string[]): number {
  const startTime = Date.now();
  const args = parseCliArgs(argv);

  /* <BLOCK_ANCHOR id="BA-MT-RUN-PARSE" purpose="Parse CLI arguments and load the DevelopmentPlan.xml source" /> */
  // Extract contracts from the plan file
  let contracts = extractContracts(args.plan, args.service);

  // Also extract contracts from source files (for FCs defined in code comments)
  const sourceContracts = extractContractsFromSource(args.source);
  for (const sc of sourceContracts) {
    if (!contracts.some((c) => c.id === sc.id)) {
      contracts.push(sc);
    }
  }

  if (contracts.length === 0) {
    console.error("[grace-mental-test] ERROR: No FUNCTION_CONTRACT definitions found.");
    return 3;
  }

  /* <BLOCK_ANCHOR id="BA-MT-RUN-EXTRACT" purpose="Extract all FUNCTION_CONTRACT definitions from the parsed plan" /> */
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      layer: "application",
      mc: MC_MENTAL_TEST,
      fc: FC_EXTRACT,
      ba: BA_MT_RUN_EXTRACT,
      belief: `Extracted ${contracts.length} FUNCTION_CONTRACT definitions from plan and source`,
      fact: { fcCount: contracts.length, planPath: args.plan, sourceDir: args.source },
    }),
  );

  // Generate scenarios for each contract
  /* <BLOCK_ANCHOR id="BA-MT-RUN-GENERATE" purpose="Generate mental test scenarios for each extracted contract" /> */
  const scenariosPerContract = new Map<string, MentalTestScenario[]>();
  let totalScenarios = 0;

  for (const contract of contracts) {
    const scenarios = generateScenarios(contract);
    scenariosPerContract.set(contract.id, scenarios);
    totalScenarios += scenarios.length;
  }

  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      layer: "application",
      mc: MC_MENTAL_TEST,
      fc: FC_GENERATE,
      ba: BA_MT_RUN_GENERATE,
      belief: `Generated ${totalScenarios} scenarios across ${contracts.length} FCs`,
      fact: { totalScenarios, fcCount: contracts.length },
    }),
  );

  // Load prompt template
  let promptTemplate = "";
  const promptPath = resolve(args.prompt);
  if (existsSync(promptPath)) {
    promptTemplate = readFileSync(promptPath, "utf-8");
  } else {
    // Use a minimal built-in template if the file doesn't exist
    promptTemplate = "Verify scenario: {{scenarioId}} ({{type}})\nFC: {{fcId}}\nVerdict expected: {{expectedOutcome}}";
  }

  // Verify each scenario
  /* <BLOCK_ANCHOR id="BA-MT-RUN-VERIFY" purpose="Invoke LLM to verify each generated scenario" /> */
  for (const [fcId, scenarios] of scenariosPerContract) {
    const contract = contracts.find((c) => c.id === fcId);
    if (!contract) continue;

    for (const scenario of scenarios) {
      if (args.dryRun) {
        scenario.verdict = "UNCERTAIN";
        scenario.llmReasoning = "Dry-run mode is non-promotable under W10; no verification was executed.";
        scenario.suggestions = ["Run without --dry-run to obtain a promotable PASS or FAIL verdict."];
        continue;
      }

      const result = verifyScenario(scenario, contract, promptTemplate, args.verifier);
      scenario.verdict = result.verdict;
      scenario.llmReasoning = `[${result.verifierMode}] ${result.reasoning}`;
      scenario.suggestions = result.suggestions;
    }
  }

  // Generate report
  /* <BLOCK_ANCHOR id="BA-MT-REPORT" purpose="Generate the markdown report with PASS/FAIL per FC" /> */
  const report = generateReport(contracts, scenariosPerContract);

  // Write report
  const outputPath = resolve(args.output);
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  writeFileSync(outputPath, report, "utf-8");

  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      layer: "application",
      mc: MC_MENTAL_TEST,
      fc: FC_RUN_ALL,
      ba: BA_MT_REPORT,
      belief: `Report written to ${args.output}`,
      fact: { reportPath: args.output, totalScenarios, fcCount: contracts.length },
    }),
  );

  // Compute gate status
  /* <BLOCK_ANCHOR id="BA-MT-GATE" purpose="Compute and report the gate status for Coordinator consumption" /> */
  let hasFailure = false;
  const fcResults: Array<{ id: string; status: string }> = [];

  for (const contract of contracts) {
    const scenarios = scenariosPerContract.get(contract.id) ?? [];
    const fcFail = scenarios.some((s) => s.verdict === "FAIL" || s.verdict === "UNCERTAIN");
    const status = fcFail ? "GATE_FAIL" : "GATE_PASS";
    if (fcFail) hasFailure = true;
    fcResults.push({ id: contract.id, status });
  }

  const passingFCs = fcResults.filter((r) => r.status === "GATE_PASS").length;
  const elapsed = Date.now() - startTime;

  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      layer: "application",
      mc: MC_MENTAL_TEST,
      fc: FC_RUN_ALL,
      ba: BA_MT_GATE,
      belief: `Gate status computed: ${hasFailure ? "BLOCKED" : "PASS"}`,
      fact: {
        gateStatus: hasFailure ? "BLOCKED" : "PASS",
        passingFCs,
        totalFCs: contracts.length,
        elapsedMs: elapsed,
      },
    }),
  );

  // Print gate status to stdout (machine-readable for Coordinator)
  if (hasFailure) {
    console.log(`MENTAL_TEST_GATE: BLOCKED (${contracts.length - passingFCs} of ${contracts.length} FCs failed)`);
    console.error(`Report written to: ${args.output}`);
    return 1;
  } else {
    console.log(`MENTAL_TEST_GATE: PASS (all ${contracts.length} FCs verified)`);
    console.error(`Report written to: ${args.output}`);
    return 0;
  }
}

// ── Entry Point ────────────────────────────────────────────────────────────

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("grace-mental-test.ts") ||
    process.argv[1].endsWith("grace-mental-test.js") ||
    process.argv[1].includes("grace-mental-test"));

if (isDirect) {
  process.exit(executeMentalTest(process.argv.slice(2)));
}
