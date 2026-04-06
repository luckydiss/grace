#!/usr/bin/env npx tsx
/**
 * <!-- MODULE_MAP id="MM-grace-log-trace" -->
 * <Layers>
 *   <Layer name="domain" package="tools/grace-log-trace.ts">
 *     Log line parsing (parseLogLine), source location resolution (findSourceLocations).
 *     Pure functions with no I/O side effects beyond stderr warnings.
 *   </Layer>
 *   <Layer name="application" package="tools/grace-log-trace.ts">
 *     Orchestration: argument parsing, stdin/file reading, replay mode, output formatting.
 *     Entry point (main) coordinates domain functions with I/O.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="DevelopmentExecutionPlan.xml#W2-T2"/>
 *   <Link ref="DevelopmentPlan.xml#DP-SVC-demo-http"/>
 *   <Link ref="RUNTIME_LOGGING.md"/>
 * </Links>
 * <!-- /MODULE_MAP -->
 */

/**
 * <MODULE_CONTRACT id="MC-grace-log-trace" version="1.0.0">
 *   <Purpose>
 *     CLI tool that maps GRACE runtime JSON log lines back to source code blocks
 *     by correlating mc (MODULE_CONTRACT), fc (FUNCTION_CONTRACT), and ba (BLOCK_ANCHOR)
 *     fields with annotated source files in the repository.
 *   </Purpose>
 *   <Responsibilities>
 *     <Item>Parse JSON Lines from stdin or a file, extracting mc/fc/ba/belief/fact fields</Item>
 *     <Item>Grep source tree for matching MODULE_CONTRACT, FUNCTION_CONTRACT, and BLOCK_ANCHOR markers</Item>
 *     <Item>Output file path, line number, and surrounding code context per log entry</Item>
 *     <Item>Build call chain (replay mode) ordered by BA sequence from a complete log file</Item>
 *   </Responsibilities>
 *   <Invariants>
 *     <I1>Each log line is parsed independently; malformed lines are skipped with a warning to stderr</I1>
 *     <I2>Source grep is case-sensitive and matches the exact anchor ID strings from the log</I2>
 *     <I3>Output is deterministic: same log input produces identical trace output regardless of invocation time</I3>
 *     <I4>Replay mode preserves original log order (ts field) when building the call chain</I4>
 *   </Invariants>
 *   <Inputs>
 *     <Input name="stdin|file">JSON Lines log stream per RUNTIME_LOGGING.md format</Input>
 *     <Input name="--replay">Flag: read full file, build ordered call chain by BA sequence</Input>
 *     <Input name="--context">Optional: number of surrounding lines to show (default 3)</Input>
 *     <Input name="--source-root">Optional: root directory to grep (default: current working directory)</Input>
 *     <Input name="--format">Optional: output format — text (default) or json</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="stdout">Per log entry: file:line + context snippet, or JSON if --format=json</Output>
 *     <Output name="stderr">Parse warnings, missing anchor notices</Output>
 *     <Output name="exit-code">0 success, 1 parse failure, 2 no matches found</Output>
 *   </Outputs>
 *   <Links>
 *     <Link ref="RUNTIME_LOGGING.md#2"/>
 *     <Link ref="DevelopmentExecutionPlan.xml#W2-T2"/>
 *     <Link ref="DevelopmentPlan.xml#DP-SVC-demo-http"/>
 *   </Links>
 * </MODULE_CONTRACT>
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";

// ── Types ──────────────────────────────────────────────────────────────────

interface LogEntry {
  ts?: string;
  mc: string;
  fc: string;
  ba?: string;
  uc?: string;
  belief?: string;
  fact?: unknown;
  layer?: string;
  [key: string]: unknown;
}

interface SourceLocation {
  file: string;
  line: number;
  context: string[];
}

interface TraceResult {
  entry: LogEntry;
  locations: SourceLocation[];
}

interface ChainEntry {
  order: number;
  ts: string;
  mc: string;
  fc: string;
  ba: string;
  belief: string;
  fact: unknown;
  file: string;
  line: number;
  context: string[];
}

interface CliArgs {
  replay: boolean;
  context: number;
  sourceRoot: string;
  format: "text" | "json";
  filePath?: string;
}

// ── Argument parsing ───────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    replay: false,
    context: 3,
    sourceRoot: process.cwd(),
    format: "text",
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--replay") {
      args.replay = true;
      i++;
    } else if (arg === "--context") {
      args.context = Number(argv[++i]) || 3;
      i++;
    } else if (arg === "--source-root") {
      args.sourceRoot = argv[++i] ?? args.sourceRoot;
      i++;
    } else if (arg === "--format") {
      const fmt = argv[++i];
      if (fmt === "json" || fmt === "text") {
        args.format = fmt;
      }
      i++;
    } else if (!arg.startsWith("-")) {
      args.filePath = arg;
      i++;
    } else {
      i++;
    }
  }

  return args;
}

// ── Domain: Log parsing ────────────────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-grace-log-trace-parseLogLine">
 *   <Intent>Parse a single JSON log line into a structured LogEntry object.</Intent>
 *   <Inputs>
 *     <Input name="rawLine">Raw JSON string from stdin or file line</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="entry">LogEntry { ts, mc, fc, ba?, uc?, belief?, fact?, layer? } or null if malformed</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-GLT-PARSE-01"/>
 *   </BlockAnchors>
 *   <ErrorHandling>
 *     <Item>Invalid JSON: emit warning to stderr, return null</Item>
 *     <Item>Missing mc or fc: emit warning, return partial entry with available fields</Item>
 *   </ErrorHandling>
 *   <Tests>
 *     <TC id="TC-GLT-PARSE-001">Valid JSON with all fields → full LogEntry</TC>
 *     <TC id="TC-GLT-PARSE-002">Missing optional ba → LogEntry with ba=undefined</TC>
 *     <TC id="TC-GLT-PARSE-003">Invalid JSON → null + stderr warning</TC>
 *     <TC id="TC-GLT-PARSE-004">Empty line → skip silently</TC>
 *   </Tests>
 *   <Links>
 *     <Link ref="RUNTIME_LOGGING.md#3"/>
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
function parseLogLine(rawLine: string): LogEntry | null {
  /* <BLOCK_ANCHOR id="BA-GLT-PARSE-01" purpose="Parse JSON line and validate fields" /> */
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    process.stderr.write(`[grace-log-trace] WARN: invalid JSON, skipping: ${trimmed.slice(0, 120)}\n`);
    return null;
  }

  if (typeof parsed.mc !== "string" || typeof parsed.fc !== "string") {
    process.stderr.write(
      `[grace-log-trace] WARN: missing mc/fc fields, skipping: ${trimmed.slice(0, 120)}\n`,
    );
    return null;
  }

  return {
    ts: typeof parsed.ts === "string" ? parsed.ts : undefined,
    mc: parsed.mc,
    fc: parsed.fc,
    ba: typeof parsed.ba === "string" ? parsed.ba : undefined,
    uc: typeof parsed.uc === "string" ? parsed.uc : undefined,
    belief: typeof parsed.belief === "string" ? parsed.belief : undefined,
    fact: parsed.fact,
    layer: typeof parsed.layer === "string" ? parsed.layer : undefined,
  };
}

// ── Domain: Source tree grep ───────────────────────────────────────────────

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "docs", ".kilo"]);

function collectFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) {
      continue;
    }
    const fullPath = join(dir, entry);
    let st;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      results.push(...collectFiles(fullPath, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      results.push(fullPath);
    }
  }

  return results;
}

function grepFileForId(filePath: string, id: string): { line: number; context: string[] } | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(id)) {
      return { line: i + 1, context: lines };
    }
  }
  return null;
}

function isSourceFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.startsWith("src/") || normalized.startsWith("src\\");
}

function prioritizeBySrcFirst(locations: SourceLocation[]): SourceLocation[] {
  const srcFiles = locations.filter((l) => isSourceFile(l.file));
  const otherFiles = locations.filter((l) => !isSourceFile(l.file));
  return srcFiles.length > 0 ? srcFiles : otherFiles;
}

function extractContext(allLines: string[], targetLine: number, contextLines: number): string[] {
  const start = Math.max(0, targetLine - 1 - contextLines);
  const end = Math.min(allLines.length, targetLine + contextLines);
  const result: string[] = [];
  for (let i = start; i < end; i++) {
    result.push(`  ${String(i + 1).padStart(4)} | ${allLines[i]}`);
  }
  return result;
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-log-trace-findSource">
 *   <Intent>
 *     Search the source tree for files containing the given mc, fc, and optionally ba marker IDs.
 *     Return the file path, line number, and surrounding context lines.
 *   </Intent>
 *   <Inputs>
 *     <Input name="entry">LogEntry with mc, fc, and optional ba fields</Input>
 *     <Input name="sourceRoot">Root directory to search</Input>
 *     <Input name="contextLines">Number of lines before/after to include (default 3)</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="locations">Array of SourceLocation { file, line, context[] }</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-GLT-GREP-01"/>
 *   </BlockAnchors>
 *   <ErrorHandling>
 *     <Item>No matches for ba: fall back to fc-only search</Item>
 *     <Item>No matches for fc: fall back to mc-only search</Item>
 *     <Item>No matches at all: emit stderr notice, return empty array</Item>
 *   </ErrorHandling>
 *   <Tests>
 *     <TC id="TC-GLT-GREP-001">BA found → single SourceLocation at exact line</TC>
 *     <TC id="TC-GLT-GREP-002">BA not found, FC found → SourceLocation at FC line</TC>
 *     <TC id="TC-GLT-GREP-003">No markers found → empty array + stderr notice</TC>
 *     <TC id="TC-GLT-GREP-004">Multiple files match → all locations returned</TC>
 *   </Tests>
 *   <Links>
 *     <Link ref="RUNTIME_LOGGING.md#5"/>
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
function findSourceLocations(
  entry: LogEntry,
  sourceRoot: string,
  contextLines: number,
): SourceLocation[] {
  /* <BLOCK_ANCHOR id="BA-GLT-GREP-01" purpose="Grep source tree for MC/FC/BA markers with fallback chain" /> */
  const extensions = [".ts", ".js", ".tsx", ".jsx", ".java", ".xml", ".md"];
  const files = collectFiles(sourceRoot, extensions);

  const searchOrder: Array<{ id: string; label: string }> = [];

  if (entry.ba) {
    searchOrder.push({ id: entry.ba, label: "BA" });
  }
  searchOrder.push({ id: entry.fc, label: "FC" });
  searchOrder.push({ id: entry.mc, label: "MC" });

  const seen = new Set<string>();

  for (const target of searchOrder) {
    if (seen.has(target.id)) {
      continue;
    }
    seen.add(target.id);

    const locations: SourceLocation[] = [];
    for (const file of files) {
      const hit = grepFileForId(file, target.id);
      if (hit) {
        locations.push({
          file: relative(sourceRoot, file),
          line: hit.line,
          context: extractContext(hit.context, hit.line, contextLines),
        });
      }
    }

    if (locations.length > 0) {
      return prioritizeBySrcFirst(locations);
    }
  }

  process.stderr.write(
    `[grace-log-trace] no source match for mc=${entry.mc} fc=${entry.fc} ba=${entry.ba ?? "n/a"}\n`,
  );
  return [];
}

// ── Application: Output formatting ─────────────────────────────────────────

function formatTraceText(result: TraceResult, index: number): string {
  const lines: string[] = [];
  lines.push(`--- Log Entry ${index + 1} ---`);
  lines.push(`  ts:       ${result.entry.ts ?? "n/a"}`);
  lines.push(`  mc:       ${result.entry.mc}`);
  lines.push(`  fc:       ${result.entry.fc}`);
  lines.push(`  ba:       ${result.entry.ba ?? "n/a"}`);

  if (result.entry.belief) {
    lines.push(`  belief:   ${result.entry.belief}`);
  }
  if (result.entry.fact !== undefined) {
    lines.push(`  fact:     ${JSON.stringify(result.entry.fact)}`);
  }

  if (result.locations.length === 0) {
    lines.push(`  source:   (not found)`);
  } else {
    for (const loc of result.locations) {
      lines.push(`  source:   ${loc.file}:${loc.line}`);
      for (const ctx of loc.context) {
        lines.push(ctx);
      }
    }
  }

  return lines.join("\n");
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-log-trace-traceFile">
 *   <Intent>Read a log file line by line, parse each entry, resolve source locations, and output the trace.</Intent>
 *   <Inputs>
 *     <Input name="filePath">Path to JSON Lines log file</Input>
 *     <Input name="sourceRoot">Root directory to grep</Input>
 *     <Input name="contextLines">Surrounding lines count</Input>
 *     <Input name="outputFormat">'text' or 'json'</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="stdout">Trace output (text or JSON array)</Output>
 *     <Output name="exitCode">0 success, 1 parse failure, 2 no matches</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-GLT-OUTPUT-01"/>
 *   </BlockAnchors>
 *   <Tests>
 *     <TC id="TC-GLT-FILE-001">Valid log file with matching source → trace output</TC>
 *     <TC id="TC-GLT-FILE-002">Log file with no source matches → exit code 2</TC>
 *     <TC id="TC-GLT-FILE-003">Log file with --format=json → valid JSON array</TC>
 *   </Tests>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W2-T2"/>
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
function traceFile(args: CliArgs): number {
  /* <BLOCK_ANCHOR id="BA-GLT-OUTPUT-01" purpose="Read file, parse lines, resolve sources, emit trace" /> */
  if (!args.filePath) {
    process.stderr.write("[grace-log-trace] ERROR: no file path provided\n");
    return 1;
  }

  let content: string;
  try {
    content = readFileSync(args.filePath, "utf-8");
  } catch (err) {
    process.stderr.write(`[grace-log-trace] ERROR: cannot read file: ${args.filePath}\n`);
    return 1;
  }

  const lines = content.split("\n");
  const results: TraceResult[] = [];

  for (const rawLine of lines) {
    const entry = parseLogLine(rawLine);
    if (!entry) {
      continue;
    }
    const locations = findSourceLocations(entry, args.sourceRoot, args.context);
    results.push({ entry, locations });
  }

  if (results.length === 0) {
    process.stderr.write("[grace-log-trace] no parseable log entries found\n");
    return 0;
  }

  const hasAnyMatch = results.some((r) => r.locations.length > 0);
  if (!hasAnyMatch) {
    process.stderr.write("[grace-log-trace] no source matches for any log entry\n");
    return 2;
  }

  if (args.format === "json") {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } else {
    for (let i = 0; i < results.length; i++) {
      process.stdout.write(formatTraceText(results[i], i) + "\n\n");
    }
  }

  return 0;
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-log-trace-traceStdin">
 *   <Intent>Read JSON Lines from stdin, parse each entry, resolve source locations, and output the trace.</Intent>
 *   <Inputs>
 *     <Input name="stdin">JSON Lines stream</Input>
 *     <Input name="sourceRoot">Root directory to grep</Input>
 *     <Input name="contextLines">Surrounding lines count</Input>
 *     <Input name="outputFormat">'text' or 'json'</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="stdout">Trace output (text or JSON array)</Output>
 *     <Output name="exitCode">0 success, 1 parse failure, 2 no matches</Output>
 *   </Outputs>
 *   <Tests>
 *     <TC id="TC-GLT-STDIN-001">Piped valid log → trace output</TC>
 *     <TC id="TC-GLT-STDIN-002">Empty stdin → exit code 0, no output</TC>
 *   </Tests>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W2-T2"/>
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
async function traceStdin(args: CliArgs): Promise<number> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const results: TraceResult[] = [];

  for await (const rawLine of rl) {
    const entry = parseLogLine(rawLine);
    if (!entry) {
      continue;
    }
    const locations = findSourceLocations(entry, args.sourceRoot, args.context);
    results.push({ entry, locations });
  }

  if (results.length === 0) {
    process.stderr.write("[grace-log-trace] no parseable log entries found\n");
    return 0;
  }

  const hasAnyMatch = results.some((r) => r.locations.length > 0);
  if (!hasAnyMatch) {
    process.stderr.write("[grace-log-trace] no source matches for any log entry\n");
    return 2;
  }

  if (args.format === "json") {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } else {
    for (let i = 0; i < results.length; i++) {
      process.stdout.write(formatTraceText(results[i], i) + "\n\n");
    }
  }

  return 0;
}

// ── Application: Replay mode ───────────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-grace-log-trace-replay">
 *   <Intent>
 *     Read full log file, sort by ts ascending, resolve all source locations,
 *     and output an ordered call chain report showing the sequence of code blocks executed.
 *   </Intent>
 *   <Inputs>
 *     <Input name="filePath">Path to JSON Lines log file (must contain multiple entries)</Input>
 *     <Input name="sourceRoot">Root directory to grep</Input>
 *     <Input name="contextLines">Surrounding lines count</Input>
 *     <Input name="outputFormat">'text' or 'json'</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="stdout">Ordered call chain: sequence of { order, ts, mc, fc, ba, file, line, context[], belief, fact }</Output>
 *     <Output name="exitCode">0 success, 1 parse failure, 2 no matches</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-GLT-CHAIN-01"/>
 *   </BlockAnchors>
 *   <Invariants>
 *     <I1>Output order matches chronological ts order from the log</I1>
 *     <I2>Each entry in the chain includes source file and line number</I2>
 *     <I3>Duplicate (mc,fc,ba) at the same ts are deduplicated into a single chain entry</I3>
 *   </Invariants>
 *   <Tests>
 *     <TC id="TC-GLT-REPLAY-001">Multi-entry log → ordered chain with correct sequence</TC>
 *     <TC id="TC-GLT-REPLAY-002">Single entry log → chain with one element</TC>
 *     <TC id="TC-GLT-REPLAY-003">Entries with same ts → stable order by original file position</TC>
 *     <TC id="TC-GLT-REPLAY-004">Entries from multiple services → chain includes all services</TC>
 *   </Tests>
 *   <Links>
 *     <Link ref="RUNTIME_LOGGING.md#5"/>
 *     <Link ref="DevelopmentExecutionPlan.xml#W2-T2"/>
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
function replay(args: CliArgs): number {
  /* <BLOCK_ANCHOR id="BA-GLT-CHAIN-01" purpose="Sort by ts, build ordered call chain, deduplicate" /> */
  if (!args.filePath) {
    process.stderr.write("[grace-log-trace] ERROR: --replay requires a file path\n");
    return 1;
  }

  let content: string;
  try {
    content = readFileSync(args.filePath, "utf-8");
  } catch {
    process.stderr.write(`[grace-log-trace] ERROR: cannot read file: ${args.filePath}\n`);
    return 1;
  }

  const rawLines = content.split("\n");
  const indexed: Array<{ entry: LogEntry; originalIndex: number }> = [];

  for (let i = 0; i < rawLines.length; i++) {
    const entry = parseLogLine(rawLines[i]);
    if (entry) {
      indexed.push({ entry, originalIndex: i });
    }
  }

  if (indexed.length === 0) {
    process.stderr.write("[grace-log-trace] no parseable log entries found\n");
    return 0;
  }

  // Sort by ts ascending; stable by original index for equal ts
  indexed.sort((a, b) => {
    const tsA = a.entry.ts ?? "";
    const tsB = b.entry.ts ?? "";
    const cmp = tsA.localeCompare(tsB);
    return cmp !== 0 ? cmp : a.originalIndex - b.originalIndex;
  });

  // Deduplicate consecutive (mc, fc, ba) at the same ts
  const deduped: Array<{ entry: LogEntry; originalIndex: number }> = [];
  const seen = new Set<string>();
  for (const item of indexed) {
    const key = `${item.entry.ts}|${item.entry.mc}|${item.entry.fc}|${item.entry.ba ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  // Resolve source locations and build chain
  const chain: ChainEntry[] = [];

  for (let i = 0; i < deduped.length; i++) {
    const { entry } = deduped[i];
    const locations = findSourceLocations(entry, args.sourceRoot, args.context);

    const file = locations.length > 0 ? locations[0].file : "(not found)";
    const line = locations.length > 0 ? locations[0].line : 0;
    const ctx = locations.length > 0 ? locations[0].context : [];

    chain.push({
      order: i + 1,
      ts: entry.ts ?? "n/a",
      mc: entry.mc,
      fc: entry.fc,
      ba: entry.ba ?? "n/a",
      belief: entry.belief ?? "",
      fact: entry.fact,
      file,
      line,
      context: ctx,
    });
  }

  if (chain.length === 0) {
    process.stderr.write("[grace-log-trace] no source matches for any log entry\n");
    return 2;
  }

  if (args.format === "json") {
    process.stdout.write(JSON.stringify(chain, null, 2) + "\n");
  } else {
    process.stdout.write("--- Call Chain (--replay mode) ---\n");
    for (const c of chain) {
      const ts = c.ts;
      const marker = `${c.mc} / ${c.fc} / ${c.ba}`;
      const target = `${c.file}:${c.line}`;
      process.stdout.write(`  [${c.order}] ${ts}  ${marker.padEnd(50)} → ${target}\n`);

      if (c.belief) {
        process.stdout.write(`       belief: ${c.belief}\n`);
      }
      if (c.fact !== undefined) {
        process.stdout.write(`       fact:   ${JSON.stringify(c.fact)}\n`);
      }
      if (c.context.length > 0) {
        for (const ctx of c.context) {
          process.stdout.write(`    ${ctx}\n`);
        }
      }
      process.stdout.write("\n");
    }
  }

  return 0;
}

// ── Entry point ────────────────────────────────────────────────────────────

async function executeLogTrace(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.replay) {
    return replay(args);
  }
  if (args.filePath) {
    return traceFile(args);
  }
  return traceStdin(args);
}

const isDirect = process.argv[1] &&
  (process.argv[1].endsWith("grace-log-trace.ts") ||
   process.argv[1].endsWith("grace-log-trace.js") ||
   process.argv[1].includes("grace-log-trace"));

if (isDirect) {
  executeLogTrace(process.argv.slice(2)).then(
    (exitCode) => process.exit(exitCode),
    (err) => {
      process.stderr.write(`[grace-log-trace] FATAL: ${err}\n`);
      process.exit(1);
    },
  );
}

export { executeLogTrace, parseLogLine, findSourceLocations };
