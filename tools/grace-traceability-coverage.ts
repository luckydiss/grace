/*
 * <MODULE_CONTRACT id="MC-grace-traceability-coverage" version="1.0.0">
 *   <Purpose>
 *     Measure the traceability chain for the current source slice and detect structural gaps in
 *     UC -> MC -> FC -> BA -> log evidence. The tool is repo-local, deterministic, and suitable
 *     for default verification of the implementable demo surface.
 *   </Purpose>
 *   <Responsibilities>
 *     <Item>Parse MODULE_CONTRACT, FUNCTION_CONTRACT, and BLOCK_ANCHOR markers from source files</Item>
 *     <Item>Extract UC refs from MC links and BA refs from FC BlockAnchors sections</Item>
 *     <Item>Verify internal chain consistency for the scanned source slice</Item>
 *     <Item>Emit a machine-readable or text coverage report with explicit issues</Item>
 *     <Item>Return non-zero exit code in strict mode when structural defects are found</Item>
 *   </Responsibilities>
 *   <Invariants>
 *     <I1>The tool is read-only and never modifies repository files.</I1>
 *     <I2>Coverage is measured for the scanned source slice; out-of-scope canonical UCs are not treated as failures.</I2>
 *     <I3>BA -> log coverage is satisfied by source-level log evidence in the same file for the current minimal implementation.</I3>
 *   </Invariants>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W7-T1"/>
 *     <Link ref="DevelopmentExecutionPlan.xml#W7-T2"/>
 *     <Link ref="DevelopmentPlan.xml#DP-SVC-grace-traceability-coverage"/>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-TRACEABILITY-COVERAGE-01"/>
 *   </Links>
 * </MODULE_CONTRACT>
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

type IssueGate = "UC_TO_MC" | "MC_TO_FC" | "FC_TO_BA" | "BA_TO_LOG" | "BIDIRECTIONAL";

interface CliArgs {
  dirs: string[];
  json: boolean;
  strict: boolean;
  runtimeLog?: string;
}

interface McContract {
  id: string;
  file: string;
  line: number;
  ucRefs: string[];
}

interface FcContract {
  id: string;
  file: string;
  line: number;
  declaredBas: string[];
  parentMcId: string | null;
}

interface BaMarker {
  id: string;
  file: string;
  line: number;
}

interface TraceabilityIssue {
  gate: IssueGate;
  severity: "BLOCKING" | "NONBLOCKING";
  sourceId: string;
  targetId: string | null;
  file: string;
  detail: string;
}

interface TraceabilityReport {
  pass: boolean;
  structuralPass: boolean;
  runtimeBackedPass: boolean;
  strict: boolean;
  summary: {
    ucCount: number;
    mcCount: number;
    fcCount: number;
    baCount: number;
    files: number;
    runtimeEvidenceCount: number;
    structuralBaCount: number;
    runtimeBackedBaCount: number;
  };
  issues: TraceabilityIssue[];
}

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "docs", ".kilo", "out"]);

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dirs: ["src"],
    json: false,
    strict: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--dir") {
      args.dirs.push(argv[++i] ?? "src");
      i++;
    } else if (arg === "--json") {
      args.json = true;
      i++;
    } else if (arg === "--strict") {
      args.strict = true;
      i++;
    } else if (arg === "--runtime-log") {
      args.runtimeLog = argv[++i] ?? args.runtimeLog;
      i++;
    } else {
      i++;
    }
  }

  if (args.dirs.length > 1 && args.dirs[0] === "src") {
    args.dirs = Array.from(new Set(args.dirs));
  }

  return args;
}

function scanDirectory(dir: string, ext: string): string[] {
  const results: string[] = [];
  let entries: string[] = [];
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
      results.push(...scanDirectory(fullPath, ext));
    } else if (entry.endsWith(ext)) {
      results.push(fullPath);
    }
  }

  return results;
}

function extractMcContracts(source: string, file: string): McContract[] {
  const results: McContract[] = [];
  const regex = /<MODULE_CONTRACT\s+id="(MC-[A-Za-z0-9_-]+)"[\s\S]*?<\/MODULE_CONTRACT>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const body = match[0];
    const before = source.slice(0, match.index);
    const line = before.split("\n").length;
    const ucRefs = Array.from(body.matchAll(/RequirementsAnalysis\.xml#(UC-[A-Za-z0-9_-]+)/g), (m) => m[1]);
    results.push({ id: match[1], file, line, ucRefs });
  }
  return results;
}

function extractFcContracts(source: string, file: string): Array<{ id: string; file: string; line: number; declaredBas: string[] }> {
  const results: Array<{ id: string; file: string; line: number; declaredBas: string[] }> = [];
  const regex = /<FUNCTION_CONTRACT\s+id="(FC-[A-Za-z0-9_-]+)"[\s\S]*?<\/FUNCTION_CONTRACT>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const body = match[0];
    const before = source.slice(0, match.index);
    const line = before.split("\n").length;
    const declaredBas = Array.from(body.matchAll(/<BA\s+ref="(BA-[A-Za-z0-9_-]+)"/g), (m) => m[1]);
    results.push({ id: match[1], file, line, declaredBas });
  }
  return results;
}

function extractBaMarkers(source: string, file: string): BaMarker[] {
  const results: BaMarker[] = [];
  const lines = source.split("\n");
  const regex = /<BLOCK_ANCHOR\s+id="(BA-[A-Za-z0-9_-]+)"/g;

  for (let i = 0; i < lines.length; i++) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(lines[i])) !== null) {
      results.push({ id: match[1], file, line: i + 1 });
    }
  }

  return results;
}

function hasFileLevelLogEvidence(source: string): boolean {
  return /graceRuntimeLog\s*\(\s*\{[\s\S]*?\bba\s*:/m.test(source) ||
    /JSON\.stringify\s*\(\s*\{[\s\S]*?\bba\s*:/m.test(source) ||
    /\[BLOCK=BA-[A-Za-z0-9_-]+\]/.test(source);
}

function collectRuntimeEvidence(path: string | undefined): Set<string> {
  const baIds = new Set<string>();
  if (!path) {
    return baIds;
  }

  let content = "";
  try {
    content = readFileSync(resolve(process.cwd(), path), "utf-8");
  } catch {
    return baIds;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as { ba?: unknown };
      if (typeof parsed.ba === "string") {
        baIds.add(parsed.ba);
      }
    } catch {
      const match = trimmed.match(/\[BLOCK=(BA-[A-Za-z0-9_-]+)\]/);
      if (match) {
        baIds.add(match[1]);
      }
    }
  }

  return baIds;
}

function formatReport(report: TraceabilityReport, jsonMode: boolean): string {
  if (jsonMode) {
    return JSON.stringify(report, null, 2);
  }

  const lines: string[] = [];
  lines.push(report.pass ? "TRACEABILITY_PASS" : "TRACEABILITY_FAIL");
  lines.push(`STRUCTURAL=${report.structuralPass ? "PASS" : "FAIL"} RUNTIME_BACKED=${report.runtimeBackedPass ? "PASS" : "FAIL"}`);
  lines.push(
    `UC=${report.summary.ucCount} MC=${report.summary.mcCount} FC=${report.summary.fcCount} BA=${report.summary.baCount} FILES=${report.summary.files} STRUCTURAL_BA=${report.summary.structuralBaCount} RUNTIME_BA=${report.summary.runtimeBackedBaCount}`,
  );

  if (report.issues.length > 0) {
    lines.push("");
    for (const issue of report.issues) {
      lines.push(
        `[${issue.gate}] ${issue.file} ${issue.sourceId}${issue.targetId ? ` -> ${issue.targetId}` : ""}: ${issue.detail}`,
      );
    }
  }

  return lines.join("\n");
}

/*
 * <FUNCTION_CONTRACT id="FC-grace-traceability-coverage-executeCoverage">
 *   <Intent>
 *     Execute traceability coverage measurement for the requested source directory and emit a deterministic report.
 *   </Intent>
 *   <Inputs>
 *     <Input name="argv">Raw CLI arguments.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="exitCode">0 when coverage passes, 1 when strict mode finds issues.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-TRACE-COLLECT"/>
 *     <BA ref="BA-TRACE-UC-MC"/>
 *     <BA ref="BA-TRACE-MC-FC"/>
 *     <BA ref="BA-TRACE-FC-BA"/>
 *     <BA ref="BA-TRACE-BA-LOG"/>
 *     <BA ref="BA-TRACE-EXIT"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
function executeCoverage(argv: string[]): number {
  const args = parseCliArgs(argv);
  const files = args.dirs.flatMap((dir) => scanDirectory(resolve(process.cwd(), dir), ".ts"));
  const issues: TraceabilityIssue[] = [];

  const mcs: McContract[] = [];
  const fcs: FcContract[] = [];
  const bas: BaMarker[] = [];
  const logEvidenceByFile = new Map<string, boolean>();
  const runtimeEvidence = collectRuntimeEvidence(args.runtimeLog);
  let structuralBaCount = 0;
  let runtimeBackedBaCount = 0;

  /* <BLOCK_ANCHOR id="BA-TRACE-COLLECT" purpose="Collect contracts, anchors, and source-level log evidence from the scanned source slice" /> */
  for (const filePath of files) {
    const relPath = relative(process.cwd(), filePath);
    const source = readFileSync(filePath, "utf-8");
    const fileMcs = extractMcContracts(source, relPath);
    const fileFcs = extractFcContracts(source, relPath);
    const fileBas = extractBaMarkers(source, relPath);

    for (const fc of fileFcs) {
      let parentMcId: string | null = null;
      for (const mc of fileMcs) {
        if (mc.line <= fc.line && (!parentMcId || mc.line > (fileMcs.find((item) => item.id === parentMcId)?.line ?? 0))) {
          parentMcId = mc.id;
        }
      }
      fcs.push({ ...fc, parentMcId });
    }

    mcs.push(...fileMcs);
    bas.push(...fileBas);
    logEvidenceByFile.set(relPath, hasFileLevelLogEvidence(source));
  }

  const ucToMcs = new Map<string, string[]>();
  for (const mc of mcs) {
    for (const ucRef of mc.ucRefs) {
      const list = ucToMcs.get(ucRef) ?? [];
      if (!list.includes(mc.id)) {
        list.push(mc.id);
      }
      ucToMcs.set(ucRef, list);
    }
  }

  /* <BLOCK_ANCHOR id="BA-TRACE-UC-MC" purpose="Verify that every active UC in the scanned slice has at least one MC" /> */
  for (const [ucRef, mcIds] of ucToMcs) {
    if (mcIds.length === 0) {
      issues.push({
        gate: "UC_TO_MC",
        severity: "BLOCKING",
        sourceId: ucRef,
        targetId: null,
        file: args.dirs.join(","),
        detail: "no MODULE_CONTRACT references this use case in the scanned slice",
      });
    }
  }

  /* <BLOCK_ANCHOR id="BA-TRACE-MC-FC" purpose="Verify that every MC has at least one FC in the same source slice" /> */
  for (const mc of mcs) {
    const linkedFcs = fcs.filter((fc) => fc.parentMcId === mc.id);
    if (linkedFcs.length === 0) {
      issues.push({
        gate: "MC_TO_FC",
        severity: "BLOCKING",
        sourceId: mc.id,
        targetId: null,
        file: mc.file,
        detail: "no FUNCTION_CONTRACT is attached to this MODULE_CONTRACT",
      });
    }
  }

  /* <BLOCK_ANCHOR id="BA-TRACE-FC-BA" purpose="Verify that every FC declares BAs that exist in code" /> */
  for (const fc of fcs) {
    if (fc.declaredBas.length === 0) {
      issues.push({
        gate: "FC_TO_BA",
        severity: "BLOCKING",
        sourceId: fc.id,
        targetId: null,
        file: fc.file,
        detail: "FUNCTION_CONTRACT has no declared BLOCK_ANCHOR refs",
      });
      continue;
    }

    for (const baId of fc.declaredBas) {
      const exists = bas.some((ba) => ba.file === fc.file && ba.id === baId);
      if (!exists) {
        issues.push({
          gate: "FC_TO_BA",
          severity: "BLOCKING",
          sourceId: fc.id,
          targetId: baId,
          file: fc.file,
          detail: "declared BA ref not found as a BLOCK_ANCHOR in code",
        });
      }
    }
  }

  /* <BLOCK_ANCHOR id="BA-TRACE-BA-LOG" purpose="Verify that each BA has source-level log evidence in the same file" /> */
  for (const ba of bas) {
    const hasRuntimeEvidence = runtimeEvidence.has(ba.id);
    const hasSourceEvidence = logEvidenceByFile.get(ba.file) === true;
    if (hasRuntimeEvidence || hasSourceEvidence) {
      structuralBaCount++;
    }
    if (hasRuntimeEvidence) {
      runtimeBackedBaCount++;
    }

    if (!hasRuntimeEvidence && !hasSourceEvidence) {
      issues.push({
        gate: "BA_TO_LOG",
        severity: "BLOCKING",
        sourceId: ba.id,
        targetId: null,
        file: ba.file,
        detail: "no runtime evidence or source-level log evidence found for this BA",
      });
      continue;
    }

    if (args.strict && !hasRuntimeEvidence) {
      issues.push({
        gate: "BA_TO_LOG",
        severity: "BLOCKING",
        sourceId: ba.id,
        targetId: null,
        file: ba.file,
        detail: "strict mode requires runtime-backed evidence for this BA; source-level evidence alone is insufficient",
      });
    }
  }

  for (const ba of bas) {
    const referenced = fcs.some((fc) => fc.file === ba.file && fc.declaredBas.includes(ba.id));
    if (!referenced) {
      issues.push({
        gate: "BIDIRECTIONAL",
        severity: "BLOCKING",
        sourceId: ba.id,
        targetId: null,
        file: ba.file,
        detail: "orphan BA is not referenced by any FUNCTION_CONTRACT in the same file",
      });
    }
  }

  const structuralPass = !issues.some(
    (issue) => issue.gate === "BA_TO_LOG" && issue.detail.includes("no runtime evidence or source-level log evidence"),
  ) && !issues.some((issue) => issue.gate !== "BA_TO_LOG");
  const runtimeBackedPass = bas.every((ba) => runtimeEvidence.has(ba.id));

  const report: TraceabilityReport = {
    pass: issues.length === 0,
    structuralPass,
    runtimeBackedPass,
    strict: args.strict,
    summary: {
      ucCount: ucToMcs.size,
      mcCount: mcs.length,
      fcCount: fcs.length,
      baCount: bas.length,
      files: files.length,
      runtimeEvidenceCount: runtimeEvidence.size,
      structuralBaCount,
      runtimeBackedBaCount,
    },
    issues,
  };

  console.log(formatReport(report, args.json));

  /* <BLOCK_ANCHOR id="BA-TRACE-EXIT" purpose="Return strict-mode traceability verdict" /> */
  if (args.strict && issues.length > 0) {
    return 1;
  }
  return 0;
}

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("grace-traceability-coverage.ts") ||
    process.argv[1].endsWith("grace-traceability-coverage.js") ||
    process.argv[1].includes("grace-traceability-coverage"));

if (isDirect) {
  process.exit(executeCoverage(process.argv.slice(2)));
}

export { executeCoverage };
