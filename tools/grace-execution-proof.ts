#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { validateSkillTraceDocumentValue, type SkillTraceDocument } from "./grace-schema.js";

interface CliArgs {
  dir: string;
  json: boolean;
}

interface ExecutionIssue {
  code: string;
  file: string;
  detail: string;
}

interface ExecutionReport {
  valid: boolean;
  checks: number;
  issues: ExecutionIssue[];
  roles: string[];
}

interface ParsedExecution {
  file: string;
  rootTag: string;
  id: string;
  traceId: string;
  actorRole: string;
  sequence: number;
  inputRefs: string[];
  outputRefs: string[];
  skills: string[];
}

interface ParsedSkillTrace {
  file: string;
  document: SkillTraceDocument;
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dir: "docs/grace/executions", json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dir") {
      args.dir = argv[++i] ?? args.dir;
    } else if (arg === "--json") {
      args.json = true;
    }
  }
  return args;
}

function listXmlFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      results.push(...listXmlFiles(fullPath));
    } else if (entry.endsWith(".xml")) {
      results.push(fullPath);
    }
  }
  return results;
}

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      results.push(...listJsonFiles(fullPath));
    } else if (entry.endsWith(".json")) {
      results.push(fullPath);
    }
  }
  return results;
}

function parseExecution(filePath: string): ParsedExecution | null {
  const xml = readFileSync(filePath, "utf8");
  const rootMatch = xml.match(/<([A-Za-z]+Execution)\b([^>]*)>/);
  if (!rootMatch) {
    return null;
  }
  const id = /id="([^"]+)"/.exec(rootMatch[2])?.[1] ?? "";
  const traceId = /traceId="([^"]+)"/.exec(rootMatch[2])?.[1] ?? "";
  const actorRole = /actorRole="([^"]+)"/.exec(rootMatch[2])?.[1] ?? "";
  const sequence = Number(/sequence="([^"]+)"/.exec(rootMatch[2])?.[1] ?? "0");
  const inputBlock = xml.match(/<InputRefs>([\s\S]*?)<\/InputRefs>/)?.[1] ?? "";
  const outputBlock = xml.match(/<OutputRefs>([\s\S]*?)<\/OutputRefs>/)?.[1] ?? "";
  const inputRefs = Array.from(inputBlock.matchAll(/<Ref\s+value="([^"]+)"/g), (match) => match[1]);
  const outputRefs = Array.from(outputBlock.matchAll(/<Ref\s+value="([^"]+)"/g), (match) => match[1]);
  const skills = Array.from(xml.matchAll(/<Skill\s+name="([^"]+)"/g), (match) => match[1]);
  return {
    file: filePath,
    rootTag: rootMatch[1],
    id,
    traceId,
    actorRole,
    sequence,
    inputRefs,
    outputRefs,
    skills,
  };
}

function parseSkillTrace(filePath: string): ParsedSkillTrace | null {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    (raw as Record<string, unknown>).schemaVersion !== "grace-skill-trace-v1"
  ) {
    return null;
  }
  return {
    file: filePath,
    document: validateSkillTraceDocumentValue(raw),
  };
}

function addIssue(issues: ExecutionIssue[], condition: boolean, code: string, file: string, detail: string): void {
  if (!condition) {
    issues.push({ code, file, detail });
  }
}

function main(): number {
  const args = parseCliArgs(process.argv.slice(2));
  const executionDir = resolve(args.dir);
  const issues: ExecutionIssue[] = [];
  let checks = 0;

  const files = listXmlFiles(executionDir);
  const jsonFiles = listJsonFiles(executionDir);
  checks++;
  addIssue(issues, files.length > 0, "MISSING_EXECUTION_FILES", args.dir, "expected at least one execution artifact");

  const parsed = files.map(parseExecution).filter((item): item is ParsedExecution => item !== null);
  const parsedSkillTraces = jsonFiles.map(parseSkillTrace).filter((item): item is ParsedSkillTrace => item !== null);
  for (const item of parsed) {
    checks++;
    addIssue(issues, item.id.length > 0, "EXECUTION_ID", item.file, "execution artifact is missing id");
    checks++;
    addIssue(issues, item.actorRole.length > 0, "EXECUTION_ROLE", item.file, "execution artifact is missing actorRole");
    checks++;
    addIssue(issues, item.sequence > 0, "EXECUTION_SEQUENCE", item.file, "execution artifact must declare a positive sequence");
    checks++;
    addIssue(issues, item.inputRefs.length > 0, "EXECUTION_INPUT_REFS", item.file, "execution artifact must declare at least one input ref");
    checks++;
    addIssue(issues, item.outputRefs.length > 0, "EXECUTION_OUTPUT_REFS", item.file, "execution artifact must declare at least one output ref");
    checks++;
    addIssue(issues, item.skills.length > 0, "EXECUTION_SKILLS", item.file, "execution artifact should declare required skills");
    checks++;
    addIssue(issues, item.traceId.length > 0, "EXECUTION_TRACE_ID", item.file, "execution artifact is missing traceId");
    const expectedRootForRole =
      item.actorRole === "ARCHITECT" ? "ArchitectExecution" :
      item.actorRole === "COORDINATOR" && item.sequence === 2 ? "CoordinatorExecution" :
      item.actorRole === "COORDINATOR" && item.sequence === 4 ? "AutonomyCycleExecution" :
      item.actorRole === "CODER" ? "CoderExecution" :
      "";
    if (expectedRootForRole.length > 0) {
      checks++;
      addIssue(issues, item.rootTag === expectedRootForRole, "EXECUTION_ROLE_ROOT_MISMATCH", item.file, `execution root/tag mismatch for role ${item.actorRole}`);
    }

    const matchingSkillTraces = parsedSkillTraces.filter((trace) => trace.document.executionId === item.id);
    checks++;
    addIssue(issues, matchingSkillTraces.length === 1, "EXECUTION_SKILL_TRACE", item.file, `expected exactly one skill trace for execution id ${item.id}`);
    if (matchingSkillTraces.length === 1) {
      const skillTrace = matchingSkillTraces[0];
      checks++;
      addIssue(issues, skillTrace.document.traceId === item.traceId, "EXECUTION_SKILL_TRACE_TRACE_ID", skillTrace.file, "skill trace traceId must match execution traceId");
      checks++;
      addIssue(issues, skillTrace.document.actorRole === item.actorRole, "EXECUTION_SKILL_TRACE_ROLE", skillTrace.file, "skill trace actorRole must match execution actorRole");
      checks++;
      addIssue(issues, skillTrace.document.executionSequence === item.sequence, "EXECUTION_SKILL_TRACE_SEQUENCE", skillTrace.file, "skill trace executionSequence must match execution sequence");
      for (const requiredSkill of item.skills) {
        checks++;
        addIssue(
          issues,
          skillTrace.document.events.some((event) => event.skill === requiredSkill && (event.status === "LOADED" || event.status === "APPLIED")),
          "EXECUTION_SKILL_TRACE_EVENT",
          skillTrace.file,
          `skill trace must contain invocation event for required skill ${requiredSkill}`,
        );
      }
    }
  }

  const ordered = [...parsed].sort((left, right) => left.sequence - right.sequence);
  const roles = ordered.map((item) => item.actorRole);
  const firstRole = roles[0] ?? "";
  const secondRole = roles[1] ?? "";
  const thirdRole = roles[2] ?? "";
  checks++;
  addIssue(issues, firstRole === "ARCHITECT", args.dir, "EXECUTION_CHAIN", "first execution role should be ARCHITECT");
  checks++;
  addIssue(issues, secondRole === "COORDINATOR", args.dir, "EXECUTION_CHAIN", "second execution role should be COORDINATOR");
  checks++;
  addIssue(issues, thirdRole === "CODER", args.dir, "EXECUTION_CHAIN", "third execution role should be CODER");
  checks++;
  addIssue(issues, roles.includes("COORDINATOR"), args.dir, "EXECUTION_CHAIN", "execution chain should include COORDINATOR");

  const report: ExecutionReport = {
    valid: issues.length === 0,
    checks,
    issues,
    roles,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.valid) {
    console.log(`EXECUTION_PROOF_PASS checks=${report.checks} roles=${report.roles.join(">")}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  return report.valid ? 0 : 1;
}

process.exit(main());
