#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { validateSkillTraceDocumentValue, type SkillTraceDocument } from "./grace-schema.js";

interface CliArgs {
  dir: string;
  json: boolean;
}

interface SchemaIssue {
  code: string;
  file: string;
  detail: string;
}

interface SchemaReport {
  valid: boolean;
  checks: number;
  issues: SchemaIssue[];
  files: string[];
}

interface ParsedExecutionFile {
  file: string;
  rootTag: string;
  attrs: Record<string, string>;
  inputRefs: string[];
  outputRefs: string[];
  skills: string[];
}

interface ParsedSkillTraceFile {
  file: string;
  document: SkillTraceDocument;
}

const EXPECTATIONS: Record<string, { actorRole: string; sequence: string; skills: string[] }> = {
  ArchitectExecution: {
    actorRole: "ARCHITECT",
    sequence: "1",
    skills: ["mode-architect", "protocol-grace-markup", "protocol-decision-collapse"],
  },
  CoordinatorExecution: {
    actorRole: "COORDINATOR",
    sequence: "2",
    skills: ["mode-coordinator", "protocol-grace-traceability", "coordinator-work-orders"],
  },
  CoderExecution: {
    actorRole: "CODER",
    sequence: "3",
    skills: ["mode-coder", "protocol-grace-patch-safety", "protocol-grace-runtime-logging"],
  },
  AutonomyCycleExecution: {
    actorRole: "COORDINATOR",
    sequence: "4",
    skills: ["protocol-grace-retry-budget", "protocol-grace-forced-context", "protocol-grace-failure-memory"],
  },
};

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

function extractAttributes(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of value.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseExecutionFile(filePath: string): ParsedExecutionFile | null {
  const xml = readFileSync(filePath, "utf8");
  const rootMatch = xml.match(/<([A-Za-z]+Execution)\b([^>]*)>/);
  if (!rootMatch) {
    return null;
  }
  const inputBlock = xml.match(/<InputRefs>([\s\S]*?)<\/InputRefs>/)?.[1] ?? "";
  const outputBlock = xml.match(/<OutputRefs>([\s\S]*?)<\/OutputRefs>/)?.[1] ?? "";
  const skillBlock = xml.match(/<RequiredSkillRefs>([\s\S]*?)<\/RequiredSkillRefs>/)?.[1] ?? "";
  return {
    file: filePath,
    rootTag: rootMatch[1],
    attrs: extractAttributes(rootMatch[2]),
    inputRefs: Array.from(inputBlock.matchAll(/<Ref\s+value="([^"]+)"/g), (match) => match[1]),
    outputRefs: Array.from(outputBlock.matchAll(/<Ref\s+value="([^"]+)"/g), (match) => match[1]),
    skills: Array.from(skillBlock.matchAll(/<Skill\s+name="([^"]+)"/g), (match) => match[1]),
  };
}

function parseSkillTraceFile(filePath: string): ParsedSkillTraceFile | null {
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

function addIssue(issues: SchemaIssue[], condition: boolean, code: string, file: string, detail: string): void {
  if (!condition) {
    issues.push({ code, file, detail });
  }
}

function main(): number {
  const args = parseCliArgs(process.argv.slice(2));
  const executionDir = resolve(args.dir);
  const files = listXmlFiles(executionDir);
  const jsonFiles = listJsonFiles(executionDir);
  const issues: SchemaIssue[] = [];
  let checks = 0;

  checks++;
  addIssue(issues, files.length > 0, "MISSING_EXECUTION_XML", args.dir, "expected at least one execution XML file");

  const parsed = files.map(parseExecutionFile).filter((item): item is ParsedExecutionFile => item !== null);
  const parsedSkillTraces = jsonFiles.map(parseSkillTraceFile).filter((item): item is ParsedSkillTraceFile => item !== null);

  for (const item of parsed) {
    const expected = EXPECTATIONS[item.rootTag];
    checks++;
    addIssue(issues, expected !== undefined, "UNKNOWN_EXECUTION_ROOT", item.file, `unsupported execution root ${item.rootTag}`);
    if (!expected) {
      continue;
    }

    checks++;
    addIssue(issues, typeof item.attrs.id === "string" && item.attrs.id.length > 0, "EXECUTION_ID", item.file, "missing id attribute");
    checks++;
    addIssue(issues, item.attrs.actorRole === expected.actorRole, "EXECUTION_ACTOR_ROLE", item.file, `actorRole must equal ${expected.actorRole}`);
    checks++;
    addIssue(issues, item.attrs.sequence === expected.sequence, "EXECUTION_SEQUENCE", item.file, `sequence must equal ${expected.sequence}`);
    checks++;
    addIssue(issues, item.inputRefs.length > 0, "EXECUTION_INPUT_REFS", item.file, "InputRefs must contain at least one Ref");
    checks++;
    addIssue(issues, item.outputRefs.length > 0, "EXECUTION_OUTPUT_REFS", item.file, "OutputRefs must contain at least one Ref");
    checks++;
    addIssue(issues, item.skills.length > 0, "EXECUTION_SKILLS", item.file, "RequiredSkillRefs must contain at least one Skill");

    for (const requiredSkill of expected.skills) {
      checks++;
      addIssue(issues, item.skills.includes(requiredSkill), "EXECUTION_REQUIRED_SKILL", item.file, `missing required skill ${requiredSkill}`);
    }

    const matchingSkillTraces = parsedSkillTraces.filter((trace) => trace.document.executionId === item.attrs.id);
    checks++;
    addIssue(issues, matchingSkillTraces.length === 1, "EXECUTION_SKILL_TRACE", item.file, `expected exactly one skill trace for execution id ${item.attrs.id}`);
    if (matchingSkillTraces.length === 1) {
      const trace = matchingSkillTraces[0];
      checks++;
      addIssue(issues, trace.document.traceId === item.attrs.traceId, "EXECUTION_SKILL_TRACE_TRACE_ID", trace.file, "skill trace traceId must match execution traceId");
      checks++;
      addIssue(issues, trace.document.actorRole === item.attrs.actorRole, "EXECUTION_SKILL_TRACE_ROLE", trace.file, "skill trace actorRole must match execution actorRole");
      checks++;
      addIssue(issues, String(trace.document.executionSequence) === item.attrs.sequence, "EXECUTION_SKILL_TRACE_SEQUENCE", trace.file, "skill trace executionSequence must match execution sequence");
      for (const requiredSkill of item.skills) {
        checks++;
        addIssue(
          issues,
          trace.document.events.some((event) => event.skill === requiredSkill),
          "EXECUTION_SKILL_TRACE_EVENT",
          trace.file,
          `skill trace must record required skill ${requiredSkill}`,
        );
      }
    }
  }

  const report: SchemaReport = {
    valid: issues.length === 0,
    checks,
    issues,
    files: parsed.map((item) => item.file),
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.valid) {
    console.log(`EXECUTION_SCHEMA_PASS checks=${report.checks} files=${report.files.length}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  return report.valid ? 0 : 1;
}

process.exit(main());
