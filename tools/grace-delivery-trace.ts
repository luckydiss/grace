#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadAndValidateJsonFile, validateSkillTraceDocumentValue, type FailureEnvelope, type FailureMemoryDocument, type ForcedContextBundle, type LoopGuardVerdict, type SkillTraceDocument } from "./grace-schema.js";

interface CliArgs {
  root: string;
  executions: string;
  handoff: string;
  cwo: string;
  envelope: string;
  memory: string;
  context: string;
  guard: string;
  json: boolean;
}

interface TraceIssue {
  code: string;
  file: string;
  detail: string;
}

interface TraceReport {
  valid: boolean;
  checks: number;
  issues: TraceIssue[];
  traceId: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    root: ".",
    executions: "docs/grace/executions",
    handoff: "docs/grace/handoffs/Handoff-20260328-01-DemoHttp.xml",
    cwo: "docs/grace/cwo/CWO-20260402-01-W5-FoundationStabilization.xml",
    envelope: "../../docs/grace/reports/w11-test-failure-envelope-demo.json",
    memory: "../../docs/grace/reports/w11-failure-memory-demo.json",
    context: "../../docs/grace/reports/w11-test-failure-envelope-demo.json.forced-context.json",
    guard: "../../docs/grace/reports/w11-test-failure-envelope-demo.json.loop-guard.json",
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--root":
        args.root = argv[++i] ?? args.root;
        break;
      case "--executions":
        args.executions = argv[++i] ?? args.executions;
        break;
      case "--handoff":
        args.handoff = argv[++i] ?? args.handoff;
        break;
      case "--cwo":
        args.cwo = argv[++i] ?? args.cwo;
        break;
      case "--envelope":
        args.envelope = argv[++i] ?? args.envelope;
        break;
      case "--memory":
        args.memory = argv[++i] ?? args.memory;
        break;
      case "--context":
        args.context = argv[++i] ?? args.context;
        break;
      case "--guard":
        args.guard = argv[++i] ?? args.guard;
        break;
      case "--json":
        args.json = true;
        break;
      default:
        break;
    }
  }

  return args;
}

function addIssue(issues: TraceIssue[], condition: boolean, code: string, file: string, detail: string): void {
  if (!condition) {
    issues.push({ code, file, detail });
  }
}

function readTraceIdFromXml(filePath: string): string {
  if (!existsSync(filePath)) {
    return "";
  }
  const content = readFileSync(filePath, "utf8");
  return /traceId="([^"]+)"/.exec(content)?.[1] ?? "";
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

function loadSkillTraceFiles(dir: string): Array<{ file: string; document: SkillTraceDocument }> {
  return listJsonFiles(dir)
    .map((filePath) => {
      const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      if (
        typeof raw !== "object" ||
        raw === null ||
        Array.isArray(raw) ||
        (raw as Record<string, unknown>).schemaVersion !== "grace-skill-trace-v1"
      ) {
        return null;
      }
      return { file: filePath, document: validateSkillTraceDocumentValue(raw) };
    })
    .filter((item): item is { file: string; document: SkillTraceDocument } => item !== null);
}

function main(): number {
  const args = parseCliArgs(process.argv.slice(2));
  const root = resolve(args.root);
  const issues: TraceIssue[] = [];
  let checks = 0;

  const handoffPath = resolve(root, args.handoff);
  const cwoPath = resolve(root, args.cwo);
  const executionPaths = listXmlFiles(resolve(root, args.executions));
  const skillTraceFiles = loadSkillTraceFiles(resolve(root, args.executions));
  const envelopePath = resolve(root, args.envelope);
  const memoryPath = resolve(root, args.memory);
  const contextPath = resolve(root, args.context);
  const guardPath = resolve(root, args.guard);

  const handoffTraceId = readTraceIdFromXml(handoffPath);
  const cwoTraceId = readTraceIdFromXml(cwoPath);
  const envelope = loadAndValidateJsonFile<FailureEnvelope>(envelopePath, "failure-envelope");
  const memory = loadAndValidateJsonFile<FailureMemoryDocument>(memoryPath, "failure-memory");
  const context = loadAndValidateJsonFile<ForcedContextBundle>(contextPath, "forced-context-bundle");
  const guard = loadAndValidateJsonFile<LoopGuardVerdict>(guardPath, "loop-guard-verdict");

  const canonicalTraceId = handoffTraceId || cwoTraceId || envelope.traceId || "TRACE-MISSING";

  checks++;
  addIssue(issues, handoffTraceId.length > 0, "HANDOFF_TRACE_ID", args.handoff, "handoff must declare traceId");
  checks++;
  addIssue(issues, cwoTraceId.length > 0, "CWO_TRACE_ID", args.cwo, "cwo must declare traceId");
  checks++;
  addIssue(issues, handoffTraceId === cwoTraceId, "TRACE_CHAIN_MISMATCH", args.cwo, "handoff and cwo traceId must match");

  for (const executionPath of executionPaths) {
    const executionTraceId = readTraceIdFromXml(executionPath);
    const relFile = executionPath.replace(`${root}\\`, "").replace(/\\/g, "/");
    checks++;
    addIssue(issues, executionTraceId.length > 0, "EXECUTION_TRACE_ID", relFile, "execution artifact must declare traceId");
    checks++;
    addIssue(issues, executionTraceId === canonicalTraceId, "TRACE_CHAIN_MISMATCH", relFile, "execution traceId must match delivery trace");
  }

  for (const skillTrace of skillTraceFiles) {
    const relFile = skillTrace.file.replace(`${root}\\`, "").replace(/\\/g, "/");
    checks++;
    addIssue(issues, skillTrace.document.traceId === canonicalTraceId, "TRACE_CHAIN_MISMATCH", relFile, "skill trace traceId must match delivery trace");
    checks++;
    addIssue(issues, skillTrace.document.events.length > 0, "SKILL_TRACE_EVENTS", relFile, "skill trace must contain at least one event");
  }

  checks++;
  addIssue(issues, envelope.traceId === canonicalTraceId, "TRACE_CHAIN_MISMATCH", args.envelope, "failure envelope traceId must match delivery trace");
  checks++;
  addIssue(issues, context.traceId === canonicalTraceId, "TRACE_CHAIN_MISMATCH", args.context, "forced-context bundle traceId must match delivery trace");
  checks++;
  addIssue(issues, guard.traceId === canonicalTraceId, "TRACE_CHAIN_MISMATCH", args.guard, "loop-guard verdict traceId must match delivery trace");

  const matchingMemoryRecords = memory.records.filter((record) => record.traceId === canonicalTraceId);
  checks++;
  addIssue(issues, matchingMemoryRecords.length > 0, "TRACE_CHAIN_MISMATCH", args.memory, "failure memory must contain at least one record with matching traceId");

  const report: TraceReport = {
    valid: issues.length === 0,
    checks,
    issues,
    traceId: canonicalTraceId,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.valid) {
    console.log(`DELIVERY_TRACE_PASS traceId=${report.traceId} checks=${report.checks}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  return report.valid ? 0 : 1;
}

process.exit(main());
