#!/usr/bin/env npx tsx

/*
 * <MODULE_CONTRACT id="MC-grace-sync-contracts" version="1.0.0">
 *   <Purpose>
 *     CLI tool that verifies semantic contracts (MC, FC, BA) embedded in source files
 *     are synchronized with actual code behavior. Detects drift between declared contract
 *     metadata and runtime code, and optionally fixes contracts to match current code.
 *   </Purpose>
 *   <Responsibilities>
 *     <Item>Parse all MC, FC, BA markers from source files (reuse grace-navigate parsing)</Item>
 *     <Item>Extract contract body XML content between open/close tags for structural analysis</Item>
 *     <Item>For each FC: verify declared Preconditions/Postconditions/BlockAnchors match code</Item>
 *     <Item>For each BA: verify the code block exists and is non-empty</Item>
 *     <Item>Report mismatches (--check) or update contract text to match code (--fix)</Item>
 *   </Responsibilities>
 *   <Invariants>
 *     <I1>Parsing is read-only in --check mode; no files are modified.</I1>
 *     <I2>In --fix mode, only contract comment blocks are modified; surrounding code is never touched.</I2>
 *     <I3>All BA-* IDs referenced in an FC's BlockAnchors section must exist in the same file.</I3>
 *     <I4>An FC's declared BlockAnchors list must be a subset of actual BA markers found between that FC and the next FC (or end of file).</I4>
 *     <I5>BA code blocks (content after the marker up to the next BA/FC/MC marker) must be non-empty (not just whitespace/braces).</I5>
 *     <I6>Exit code 0 = all synchronized; exit code 1 = drift detected (--check); exit code 2 = error.</I6>
 *   </Invariants>
 *   <Collaborators>
 *     <Item>reads: source files under scan directory containing GRACE markers</Item>
 *     <Item>reuses: parseMarkers(), scanDirectory() from grace-navigate.ts</Item>
 *     <Item>references: GRACE_MARKUP_STANDARD.md (contract format definitions)</Item>
 *   </Collaborators>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W3-T1"/>
 *     <Link ref="DevelopmentPlan.xml#DP-SVC-demo-http"/>
 *     <Link ref="GRACE_MARKUP_STANDARD.md"/>
 *   </Links>
 * </MODULE_CONTRACT>
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

interface ParsedMarker {
  type: "MM" | "MC" | "FC" | "BA";
  id: string;
  file: string;
  line: number;
}

interface SyncIssue {
  file: string;
  line: number;
  fcId: string;
  type: "MISSING_BA" | "UNDECLARED_BA" | "EMPTY_BA_BLOCK" | "MISSING_PRECONDITION";
  detail: string;
}

interface ContractBody {
  marker: ParsedMarker;
  body: string | null;
  startLine: number;
  endLine: number;
  declaredBAs: string[];
}

interface SyncReport {
  synchronized: boolean;
  issues: SyncIssue[];
  fixes: string[];
  summary: { total: number; drifted: number; fixed: number; filesChecked: number };
}

interface CliArgs {
  mode: "check" | "fix";
  dir: string;
  glob: string;
  json: boolean;
  includeFiles: string[];
  includeFCs: string[];
  includeBAs: string[];
}

// ── Reusable parsing from grace-navigate.ts ────────────────────────────────

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "docs", ".kilo"]);

function scanDirectory(dir: string, ext: string): string[] {
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
      results.push(...scanDirectory(fullPath, ext));
    } else if (entry.endsWith(ext)) {
      results.push(fullPath);
    }
  }

  return results;
}

function parseMarkers(source: string, filePath: string): ParsedMarker[] {
  const markers: ParsedMarker[] = [];
  const lines = source.split("\n");
  const seen = new Set<string>();

  const mmRegex = /<!--\s*MODULE_MAP\s+id="(MM-[A-Za-z0-9_-]+)"\s*-->/g;
  const mcRegex = /<MODULE_CONTRACT\s+id="(MC-[A-Za-z0-9_-]+)"/g;
  const fcRegex = /<FUNCTION_CONTRACT\s+id="(FC-[A-Za-z0-9_-]+)"/g;
  const baRegex = /<BLOCK_ANCHOR\s+id="(BA-[A-Za-z0-9_-]+)"/g;
  const constRegex = /const\s+(MM_|MC_|FC_|BA_)[A-Za-z0-9_]+\s*=\s*"([A-Z][A-Za-z0-9_-]+)"/g;

  const markerPatterns: Array<[RegExp, ParsedMarker["type"]]> = [
    [mmRegex, "MM"],
    [mcRegex, "MC"],
    [fcRegex, "FC"],
    [baRegex, "BA"],
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    for (const [regex, markerType] of markerPatterns) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(line)) !== null) {
        const id = m[1];
        seen.add(id);
        markers.push({ type: markerType, id, file: filePath, line: lineNum });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    constRegex.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = constRegex.exec(line)) !== null) {
      const prefix = cm[1];
      const id = cm[2];
      if (seen.has(id)) continue;
      seen.add(id);
      let type: ParsedMarker["type"];
      if (prefix === "MM_") type = "MM";
      else if (prefix === "MC_") type = "MC";
      else if (prefix === "FC_") type = "FC";
      else type = "BA";
      markers.push({ type, id, file: filePath, line: lineNum });
    }
  }

  return markers;
}

// ── Contract body extraction ───────────────────────────────────────────────

/*
 * <FUNCTION_CONTRACT id="FC-grace-sync-contracts-extractContractBody">
 *   <Intent>
 *     Given a source file and a contract marker (MC or FC), extract the XML body
 *     between the open and close tags for structural analysis.
 *   </Intent>
 *   <Inputs>
 *     <Input name="source">Full file content as string.</Input>
 *     <Input name="markerLine">Line number of the contract open tag.</Input>
 *     <Input name="contractType">"MC" or "FC".</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="body">XML string between open and close tags, or null if not found.</Output>
 *     <Output name="startLine">Line number of the open tag.</Output>
 *     <Output name="endLine">Line number of the close tag.</Output>
 *   </Outputs>
 *   <Invariants>
 *     <I1>Body extraction uses paired-tag matching: find the close tag that corresponds to the open tag at markerLine.</I1>
 *     <I2>If close tag is missing, body is null and an error is recorded.</I2>
 *   </Invariants>
 * </FUNCTION_CONTRACT>
 */
function extractContractBody(
  source: string,
  markerLine: number,
  contractType: "MC" | "FC",
): { body: string | null; startLine: number; endLine: number } {
  const lines = source.split("\n");
  const tagName = contractType === "MC" ? "MODULE_CONTRACT" : "FUNCTION_CONTRACT";
  const closePattern = new RegExp(`<\\/${tagName}>`);

  // The marker line is 1-indexed
  const startIdx = markerLine - 1;

  // Scan forward from the marker line to find the close tag
  for (let i = startIdx; i < lines.length; i++) {
    if (closePattern.test(lines[i])) {
      // Collect body: everything between open tag line and close tag line
      const bodyLines = lines.slice(startIdx, i + 1);
      const body = bodyLines.join("\n");
      return { body, startLine: markerLine, endLine: i + 1 };
    }
  }

  return { body: null, startLine: markerLine, endLine: markerLine };
}

/** Extract BA ref IDs from a BlockAnchors section within contract body XML. */
function extractDeclaredBAs(body: string): string[] {
  const bas: string[] = [];

  // Find BlockAnchors section
  const baSectionMatch = body.match(/<BlockAnchors>([\s\S]*?)<\/BlockAnchors>/);
  if (!baSectionMatch) return bas;

  const section = baSectionMatch[1];
  const refRegex = /ref="(BA-[A-Za-z0-9_-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = refRegex.exec(section)) !== null) {
    bas.push(m[1]);
  }

  return bas;
}

// ── Check functions ────────────────────────────────────────────────────────

/*
 * <FUNCTION_CONTRACT id="FC-grace-sync-contracts-checkFCSync">
 *   <Intent>
 *     For a single FUNCTION_CONTRACT, verify that:
 *     (a) every BA-* in its BlockAnchors section exists in the same file,
 *     (b) all BA-* markers between this FC and the next FC are declared in BlockAnchors,
 *     (c) Preconditions referenced in the contract correspond to guard clauses or validation in the code.
 *   </Intent>
 *   <Inputs>
 *     <Input name="fcMarker">The FC ParsedMarker (id, file, line).</Input>
 *     <Input name="fcBody">Extracted XML body of the FUNCTION_CONTRACT.</Input>
 *     <Input name="allBAMarkers">All BA ParsedMarkers in the same file.</Input>
 *     <Input name="allFCMarkers">All FC ParsedMarkers in the same file (for boundary detection).</Input>
 *     <Input name="source">Full source text of the file.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="issues">Array of SyncIssue.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-SYNC-CHECK-FC"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
/* <BLOCK_ANCHOR id="BA-SYNC-CHECK-FC" purpose="Check each FC for BlockAnchors consistency" /> */
function checkFCSync(
  fcMarker: ParsedMarker,
  fcBody: string,
  allBAMarkers: ParsedMarker[],
  allFCMarkers: ParsedMarker[],
  allowedBAs: Set<string> | null,
  _source: string,
): SyncIssue[] {
  const issues: SyncIssue[] = [];

  // Determine FC scope: from this FC line to next FC line (or Infinity)
  const sortedFCs = allFCMarkers.slice().sort((a, b) => a.line - b.line);
  const fcIdx = sortedFCs.findIndex((f) => f.id === fcMarker.id && f.line === fcMarker.line);
  const nextFCLine = fcIdx >= 0 && fcIdx < sortedFCs.length - 1
    ? sortedFCs[fcIdx + 1].line
    : Infinity;

  // BA markers in this FC's scope
  const basInScope = allBAMarkers.filter(
    (ba) => ba.line > fcMarker.line && ba.line < nextFCLine,
  );

  // Declared BAs from the contract body
  const declaredBAs = extractDeclaredBAs(fcBody);
  const scopedBAs = allowedBAs ? basInScope.filter((ba) => allowedBAs.has(ba.id)) : basInScope;
  const scopedDeclaredBAs = allowedBAs ? declaredBAs.filter((baId) => allowedBAs.has(baId)) : declaredBAs;
  const declaredSet = new Set(scopedDeclaredBAs);

  // Check: declared but not found in code
  for (const baId of scopedDeclaredBAs) {
    if (!scopedBAs.some((ba) => ba.id === baId)) {
      issues.push({
        file: fcMarker.file,
        line: fcMarker.line,
        fcId: fcMarker.id,
        type: "MISSING_BA",
        detail: `${baId} declared in BlockAnchors but not found in code`,
      });
    }
  }

  // Check: found in code but not declared
  for (const ba of scopedBAs) {
    if (!declaredSet.has(ba.id)) {
      issues.push({
        file: ba.file,
        line: ba.line,
        fcId: fcMarker.id,
        type: "UNDECLARED_BA",
        detail: `${ba.id} exists in code but not declared in ${fcMarker.id} BlockAnchors`,
      });
    }
  }

  return issues;
}

/*
 * <FUNCTION_CONTRACT id="FC-grace-sync-contracts-checkBASync">
 *   <Intent>
 *     For each BLOCK_ANCHOR in a file, verify the code block it anchors exists and is non-empty.
 *   </Intent>
 *   <Inputs>
 *     <Input name="baMarker">The BA ParsedMarker.</Input>
 *     <Input name="allMarkers">All markers in the file (for boundary detection).</Input>
 *     <Input name="sourceLines">Source split by line.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="issues">Array of SyncIssue for this BA.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-SYNC-CHECK-BA"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
/* <BLOCK_ANCHOR id="BA-SYNC-CHECK-BA" purpose="Check each BA for block existence and non-emptiness" /> */
function checkBASync(
  baMarker: ParsedMarker,
  allMarkers: ParsedMarker[],
  sourceLines: string[],
): SyncIssue[] {
  const issues: SyncIssue[] = [];

  // Find the boundary: next marker after this BA
  const sortedMarkers = allMarkers
    .filter((m) => m.line > baMarker.line)
    .sort((a, b) => a.line - b.line);

  const nextMarkerLine = sortedMarkers.length > 0 ? sortedMarkers[0].line : sourceLines.length + 1;

  // Extract block: lines after BA marker up to (not including) next marker
  const blockStart = baMarker.line; // 0-indexed: baMarker.line (line after marker comment)
  const blockEnd = nextMarkerLine - 1; // 0-indexed: line before next marker

  if (blockStart >= blockEnd) {
    issues.push({
      file: baMarker.file,
      line: baMarker.line,
      fcId: "",
      type: "EMPTY_BA_BLOCK",
      detail: `${baMarker.id} has no code after the marker`,
    });
    return issues;
  }

  // Check if block has meaningful content (not just whitespace/comments)
  const blockLines = sourceLines.slice(blockStart, blockEnd);
  const hasCode = blockLines.some((line) => {
    const trimmed = line.trim();
    if (trimmed === "") return false;
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/")) return false;
    return true;
  });

  if (!hasCode) {
    issues.push({
      file: baMarker.file,
      line: baMarker.line,
      fcId: "",
      type: "EMPTY_BA_BLOCK",
      detail: `${baMarker.id} block contains only whitespace or comments`,
    });
  }

  return issues;
}

// ── Fix function ───────────────────────────────────────────────────────────

/*
 * <FUNCTION_CONTRACT id="FC-grace-sync-contracts-fixContract">
 *   <Intent>
 *     For detected drift issues, update the contract comment block in the source file
 *     to match current code behavior. Only contract text is modified; code is never changed.
 *   </Intent>
 *   <Inputs>
 *     <Input name="filePath">Path to the source file.</Input>
 *     <Input name="source">Full file content.</Input>
 *     <Input name="issues">Array of SyncIssue from check functions.</Input>
 *     <Input name="fileMarkers">All markers in this file.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="newSource">Updated source with corrected contract text.</Output>
 *     <Output name="fixes">Array of string descriptions of applied fixes.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-SYNC-FIX"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
/* <BLOCK_ANCHOR id="BA-SYNC-FIX" purpose="Apply fixes for detected drift" /> */
function fixContract(
  filePath: string,
  source: string,
  issues: SyncIssue[],
  fileMarkers: ParsedMarker[],
): { newSource: string; fixes: string[] } {
  const fixes: string[] = [];
  let lines = source.split("\n");

  // Group issues by FC
  const issuesByFC = new Map<string, SyncIssue[]>();
  for (const issue of issues) {
    if (!issue.fcId) continue;
    const list = issuesByFC.get(issue.fcId) ?? [];
    list.push(issue);
    issuesByFC.set(issue.fcId, list);
  }

  // Process each FC that has issues
  for (const [fcId, fcIssues] of issuesByFC) {
    const fcMarker = fileMarkers.find((m) => m.id === fcId && m.type === "FC");
    if (!fcMarker) continue;

    const { body, endLine } = extractContractBody(source, fcMarker.line, "FC");
    if (!body) continue;

    const missingBAs = fcIssues.filter((i) => i.type === "MISSING_BA");
    const undeclaredBAs = fcIssues.filter((i) => i.type === "UNDECLARED_BA");

    if (missingBAs.length === 0 && undeclaredBAs.length === 0) continue;

    // Re-extract the contract body from current lines array
    const currentBody = extractContractBody(lines.join("\n"), fcMarker.line, "FC");
    if (!currentBody.body) continue;

    let updatedBody = currentBody.body;

    // Remove stale BA refs (MISSING_BA)
    for (const issue of missingBAs) {
      const baId = issue.detail.split(" ")[0]; // extract BA-xxx from detail
      const refLine = new RegExp(`\\s*<BA ref="${baId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*/?>\\s*\\n?`, "g");
      updatedBody = updatedBody.replace(refLine, "");
      fixes.push(`${filePath}: removed stale ${baId} from ${fcId} BlockAnchors`);
    }

    // Add missing BA refs (UNDECLARED_BA)
    if (undeclaredBAs.length > 0) {
      const baSectionMatch = updatedBody.match(/(<BlockAnchors>)([\s\S]*?)(<\/BlockAnchors>)/);
      if (baSectionMatch) {
        const newRefs = undeclaredBAs
          .map((i) => `    <BA ref="${i.detail.split(" ")[0]}"/>`)
          .join("\n");
        const existingContent = baSectionMatch[2].trimEnd();
        const merged = existingContent
          ? `${baSectionMatch[1]}\n${existingContent}\n${newRefs}\n  ${baSectionMatch[3]}`
          : `${baSectionMatch[1]}\n${newRefs}\n  ${baSectionMatch[3]}`;
        updatedBody = updatedBody.slice(0, baSectionMatch.index!) +
          merged +
          updatedBody.slice(baSectionMatch.index! + baSectionMatch[0].length);
      }
      for (const issue of undeclaredBAs) {
        fixes.push(`${filePath}: added ${issue.detail.split(" ")[0]} to ${fcId} BlockAnchors`);
      }
    }

    // Replace in lines array
    const bodyStartIdx = fcMarker.line - 1;
    const bodyEndIdx = currentBody.endLine - 1;
    const newBodyLines = updatedBody.split("\n");
    lines = [
      ...lines.slice(0, bodyStartIdx),
      ...newBodyLines,
      ...lines.slice(bodyEndIdx + 1),
    ];
  }

  // Handle EMPTY_BA_BLOCK issues: add TODO comment
  const emptyBAIssues = issues.filter((i) => i.type === "EMPTY_BA_BLOCK");
  for (const issue of emptyBAIssues) {
    const baId = issue.detail.split(" ")[0];
    const baMarker = fileMarkers.find((m) => m.id === baId);
    if (!baMarker) continue;
    // Insert TODO comment after the BA marker line
    const insertIdx = baMarker.line; // 0-indexed line after marker
    if (insertIdx < lines.length) {
      const indent = lines[insertIdx]?.match(/^(\s*)/)?.[1] ?? "  ";
      lines.splice(insertIdx, 0, `${indent}// TODO: BA block is empty — implement or remove anchor`);
      fixes.push(`${filePath}: added TODO for empty ${baId} block`);
    }
  }

  return { newSource: lines.join("\n"), fixes };
}

// ── Report formatting ──────────────────────────────────────────────────────

/*
 * <FUNCTION_CONTRACT id="FC-grace-sync-contracts-formatReport">
 *   <Intent>
 *     Format the collected sync issues as human-readable text or JSON output.
 *   </Intent>
 *   <Inputs>
 *     <Input name="report">SyncReport object.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="output">Formatted string to print to stdout.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-SYNC-REPORT"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
/* <BLOCK_ANCHOR id="BA-SYNC-REPORT" purpose="Format and emit the sync report" /> */
function formatReport(report: SyncReport, jsonMode: boolean): string {
  if (jsonMode) {
    return JSON.stringify(report, null, 2);
  }

  if (report.issues.length === 0 && report.fixes.length === 0) {
    return "ALL_SYNCHRONIZED";
  }

  const lines: string[] = [];

  if (report.issues.length > 0) {
    lines.push("FILE                | LINE  | ISSUE             | DETAIL");
    lines.push("─".repeat(80));
    for (const issue of report.issues) {
      const file = issue.file.padEnd(19);
      const line = String(issue.line).padEnd(5);
      const type = issue.type.padEnd(17);
      lines.push(`${file} | ${line} | ${type} | ${issue.detail}`);
    }
  }

  if (report.fixes.length > 0) {
    lines.push("");
    lines.push("FIXES APPLIED:");
    for (const fix of report.fixes) {
      lines.push(`  FIXED: ${fix}`);
    }
  }

  lines.push("─".repeat(80));
  lines.push(
    `${report.summary.total} contracts checked across ${report.summary.filesChecked} files, ${report.summary.drifted} issues found, ${report.summary.fixed} fixed`,
  );

  return lines.join("\n");
}

// ── CLI argument parsing ───────────────────────────────────────────────────

/* <BLOCK_ANCHOR id="BA-SYNC-ARGPARSE" purpose="Parse CLI arguments" /> */
function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: "check",
    dir: ".",
    glob: ".ts",
    json: false,
    includeFiles: [],
    includeFCs: [],
    includeBAs: [],
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--check") {
      args.mode = "check";
      i++;
    } else if (arg === "--fix") {
      args.mode = "fix";
      i++;
    } else if (arg === "--dir") {
      args.dir = argv[++i] ?? args.dir;
      i++;
    } else if (arg === "--glob") {
      const pattern = argv[++i] ?? "";
      const extMatch = pattern.match(/\*(\.\w+)$/);
      if (extMatch) {
        args.glob = extMatch[1];
      }
      i++;
    } else if (arg === "--json") {
      args.json = true;
      i++;
    } else if (arg === "--include-file") {
      const filePath = argv[++i];
      if (filePath) {
        args.includeFiles.push(filePath);
      }
      i++;
    } else if (arg === "--include-fc") {
      const fcId = argv[++i];
      if (fcId) {
        args.includeFCs.push(fcId);
      }
      i++;
    } else if (arg === "--include-ba") {
      const baId = argv[++i];
      if (baId) {
        args.includeBAs.push(baId);
      }
      i++;
    } else {
      i++;
    }
  }

  return args;
}

// ── Main orchestrator ──────────────────────────────────────────────────────

/*
 * <FUNCTION_CONTRACT id="FC-grace-sync-contracts-executeSync">
 *   <Intent>
 *     Orchestrate the full sync-check lifecycle: parse args, scan files, extract contracts,
 *     run checks, optionally fix, and emit the report.
 *   </Intent>
 *   <Inputs>
 *     <Input name="argv">Raw CLI argument array (process.argv.slice(2)).</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="exitCode">0=synchronized, 1=drift, 2=error.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-SYNC-ARGPARSE"/>
 *     <BA ref="BA-SYNC-SCAN"/>
 *     <BA ref="BA-SYNC-EXTRACT"/>
 *     <BA ref="BA-SYNC-RUN-CHECK-FC"/>
 *     <BA ref="BA-SYNC-RUN-CHECK-BA"/>
 *     <BA ref="BA-SYNC-RUN-FIX"/>
 *     <BA ref="BA-SYNC-RUN-REPORT"/>
 *     <BA ref="BA-SYNC-EXIT"/>
 *   </BlockAnchors>
 *   <Tests>
 *     <TC id="TC-SYNC-001">All contracts in sync returns exit 0 with "ALL_SYNCHRONIZED".</TC>
 *     <TC id="TC-SYNC-002">Missing BA-id in FC BlockAnchors returns exit 1 with drift detail.</TC>
 *     <TC id="TC-SYNC-003">--fix with drift updates contract and returns exit 0.</TC>
 *     <TC id="TC-SYNC-004">--json outputs structured report.</TC>
 *     <TC id="TC-SYNC-005">No markers found returns exit 0 (nothing to check).</TC>
 *   </Tests>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W3-T1"/>
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
function executeSync(argv: string[]): number {
  // BA-SYNC-ARGPARSE
  const args = parseCliArgs(argv);
  const startTime = Date.now();

  // Validate dir exists
  try {
    const st = statSync(args.dir);
    if (!st.isDirectory()) {
      process.stderr.write(`[grace-sync-contracts] ${args.dir} is not a directory\n`);
      return 2;
    }
  } catch {
    process.stderr.write(`[grace-sync-contracts] directory not found: ${args.dir}\n`);
    return 2;
  }

  /* <BLOCK_ANCHOR id="BA-SYNC-SCAN" purpose="Scan source files for GRACE markers" /> */
  const files = args.includeFiles.length > 0
    ? args.includeFiles.map((filePath) => join(process.cwd(), filePath))
    : scanDirectory(args.dir, args.glob);

  const allMarkers: ParsedMarker[] = [];
  const fileContents = new Map<string, string>();

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const relPath = relative(process.cwd(), file);
    const markers = parseMarkers(content, relPath);
    if (markers.length > 0) {
      allMarkers.push(...markers);
      fileContents.set(relPath, content);
    }
  }

  if (allMarkers.length === 0) {
    if (args.json) {
      console.log(JSON.stringify({
        synchronized: true,
        issues: [],
        fixes: [],
        summary: { total: 0, drifted: 0, fixed: 0, filesChecked: 0 },
      }));
    } else {
      console.log("No GRACE markers found — nothing to check.");
    }
    return 0;
  }

  /* <BLOCK_ANCHOR id="BA-SYNC-EXTRACT" purpose="Extract contract bodies for MC and FC markers" /> */
  // Group markers by file
  const markersByFile = new Map<string, ParsedMarker[]>();
  for (const marker of allMarkers) {
    const list = markersByFile.get(marker.file) ?? [];
    list.push(marker);
    markersByFile.set(marker.file, list);
  }

  const allIssues: SyncIssue[] = [];
  const allFixes: string[] = [];
  let totalContracts = 0;
  const allowedBAs = args.includeBAs.length > 0 ? new Set(args.includeBAs) : null;

  /* <BLOCK_ANCHOR id="BA-SYNC-RUN-CHECK-FC" purpose="Check each FC for BlockAnchors consistency during executeSync" /> */
  /* <BLOCK_ANCHOR id="BA-SYNC-RUN-CHECK-BA" purpose="Check each BA for block existence during executeSync" /> */
  for (const [relPath, markersInFile] of markersByFile) {
    const source = fileContents.get(relPath);
    if (!source) continue;

    const sourceLines = source.split("\n");
    const fcMarkers = markersInFile
      .filter((m) => m.type === "FC")
      .filter((marker) => args.includeFCs.length === 0 || args.includeFCs.includes(marker.id));
    const baMarkers = markersInFile
      .filter((m) => m.type === "BA")
      .filter((marker) => args.includeBAs.length === 0 || args.includeBAs.includes(marker.id));

    totalContracts += fcMarkers.length;

    // Check FC sync
    for (const fc of fcMarkers) {
      const { body } = extractContractBody(source, fc.line, "FC");
      if (!body) continue;

      const fcIssues = checkFCSync(fc, body, baMarkers, fcMarkers, allowedBAs, source);
      allIssues.push(...fcIssues);
    }

    // Check BA sync
    for (const ba of baMarkers) {
      const baIssues = checkBASync(ba, markersInFile, sourceLines);
      allIssues.push(...baIssues);
    }
  }

  /* <BLOCK_ANCHOR id="BA-SYNC-RUN-FIX" purpose="Apply fixes in --fix mode during executeSync" /> */
  if (args.mode === "fix" && allIssues.length > 0) {
    // Group issues by file
    const issuesByFile = new Map<string, SyncIssue[]>();
    for (const issue of allIssues) {
      const list = issuesByFile.get(issue.file) ?? [];
      list.push(issue);
      issuesByFile.set(issue.file, list);
    }

    for (const [relPath, fileIssues] of issuesByFile) {
      const source = fileContents.get(relPath);
      if (!source) continue;

      const fileMarkers = markersByFile.get(relPath) ?? [];
      const result = fixContract(relPath, source, fileIssues, fileMarkers);

      if (result.fixes.length > 0) {
        writeFileSync(relPath, result.newSource, "utf-8");
        allFixes.push(...result.fixes);
      }
    }
  }

  const driftedCount = new Set(allIssues.map((i) => i.file)).size;

  /* <BLOCK_ANCHOR id="BA-SYNC-RUN-REPORT" purpose="Emit the report during executeSync" /> */
  const report: SyncReport = {
    synchronized: allIssues.length === 0,
    issues: allIssues,
    fixes: allFixes,
    summary: {
      total: totalContracts,
      drifted: driftedCount,
      fixed: allFixes.length,
      filesChecked: fileContents.size,
    },
  };

  const output = formatReport(report, args.json);
  console.log(output);

  /* <BLOCK_ANCHOR id="BA-SYNC-EXIT" purpose="Set exit code based on results" /> */
  // Runtime log with belief/fact
  const elapsed = Date.now() - startTime;
  process.stderr.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      layer: "application",
      mc: "MC-grace-sync-contracts",
      fc: "FC-grace-sync-contracts-executeSync",
      ba: "BA-SYNC-EXIT",
      belief: args.mode === "check"
        ? `Checked ${totalContracts} contracts, found ${allIssues.length} drift issues`
        : `Fixed ${allFixes.length} of ${allIssues.length} drift issues in ${totalContracts} contracts`,
      fact: {
        mode: args.mode,
        totalContracts,
        filesChecked: fileContents.size,
        issuesFound: allIssues.length,
        fixesApplied: allFixes.length,
        elapsedMs: elapsed,
      },
    }) + "\n",
  );

  if (args.mode === "check") {
    return allIssues.length > 0 ? 1 : 0;
  }
  return 0;
}

// ── Entry point ────────────────────────────────────────────────────────────

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("grace-sync-contracts.ts") ||
    process.argv[1].endsWith("grace-sync-contracts.js") ||
    process.argv[1].includes("grace-sync-contracts"));

if (isDirect) {
  const exitCode = executeSync(process.argv.slice(2));
  process.exit(exitCode);
}

export { executeSync, parseMarkers, extractContractBody, checkFCSync, checkBASync, formatReport };
