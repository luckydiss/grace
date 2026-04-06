/*
 * <MODULE_CONTRACT id="MC-grace-patch" version="2.0.0">
 *   <Purpose>
 *     CLI tool that patches source files at semantic coordinates (BA ids).
 *     W10 governance requires handoff-scoped approval and BranchSpec-compatible
 *     mutation boundaries for the resolved MC/FC/BA semantic context.
 *   </Purpose>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W2-T3" />
 *     <Link ref="docs/grace/handoffs/Handoff-20260402-03-W10-DeterministicExecutionGates.xml" />
 *   </Links>
 *   <Invariants>
 *     <I1>Target file must exist and be readable.</I1>
 *     <I2>Specified BA id must exist exactly once in the target file.</I2>
 *     <I3>Replacement preserves surrounding code; only the anchored region is modified.</I3>
 *     <I4>Dry-run mode never writes to disk and still enforces semantic scope authorization.</I4>
 *     <I5>Non-dry-run patching is refused without an APPROVED GRACE_APPROVAL for the authorized handoff.</I5>
 *     <I6>Authorized mutation scope is bounded by the approved MC FC BA coordinates from the Handoff and BranchSpec.</I6>
 *   </Invariants>
 * </MODULE_CONTRACT>
 */

import { readFileSync, readSync, writeFileSync, renameSync, existsSync, unlinkSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";

interface AnchorRegion {
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
  isPaired: boolean;
}

interface ContractError {
  contractId: string;
  issue: string;
}

interface PatchArgs {
  anchor: string;
  file: string;
  code: string;
  dryRun: boolean;
  agent: string;
  approvalsPath: string;
  handoff: string;
  branchSpec: string;
}

interface ReplacementScopeIssue {
  code: string;
  detail: string;
}

interface GovernanceScope {
  filePath: string;
  refId: string;
  handoffRef?: string;
  moduleContracts: Set<string>;
  functionContracts: Set<string>;
  blockAnchors: Set<string>;
}

interface SemanticMarker {
  type: "MC" | "FC" | "BA";
  id: string;
  line: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readStdinSync(): string {
  const chunks: Buffer[] = [];
  const fd = 0;
  const buf = Buffer.alloc(4096);
  while (true) {
    try {
      const bytesRead = readSync(fd, buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
    } catch {
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function parsePatchArgs(argv: string[]): PatchArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      anchor: { type: "string" },
      file: { type: "string" },
      code: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      agent: { type: "string", default: "UNKNOWN" },
      approvals: { type: "string" },
      handoff: { type: "string" },
      "branch-spec": { type: "string" },
    },
    strict: true,
  });

  const anchor = values.anchor;
  const file = values.file;
  const handoff = values.handoff;
  const branchSpec = values["branch-spec"];
  let code = values.code ?? "";

  if (!anchor || !file || !handoff || !branchSpec) {
    const missing: string[] = [];
    if (!anchor) missing.push("--anchor");
    if (!file) missing.push("--file");
    if (!handoff) missing.push("--handoff");
    if (!branchSpec) missing.push("--branch-spec");
    console.error(`PATCH_ERROR: Missing required arguments: ${missing.join(", ")}`);
    console.error(
      "Usage: grace-patch --anchor BA-* --file path --code \"new code\" --handoff Handoff-* --branch-spec BS-* [--dry-run] [--agent ID] [--approvals path]",
    );
    process.exit(!file ? 3 : 2);
  }

  if (!/^BA-[\w-]+$/.test(anchor)) {
    console.error(`PATCH_ERROR: Invalid anchor format "${anchor}". Must match /^BA-[\\w-]+$/`);
    process.exit(2);
  }

  const resolvedFile = resolve(file);
  if (!existsSync(resolvedFile)) {
    console.error(`PATCH_ERROR: File not found: ${resolvedFile}`);
    process.exit(3);
  }

  if (code === "-" || code === "") {
    if (!process.stdin.isTTY) {
      code = readStdinSync();
    }
  }

  code = code.replace(/\\n/g, "\n");
  if (code === "") {
    console.error("PATCH_ERROR: No replacement code provided. Use --code \"...\" or pipe via stdin.");
    process.exit(1);
  }

  return {
    anchor,
    file: resolvedFile,
    code,
    dryRun: values["dry-run"] ?? false,
    agent: values.agent ?? "UNKNOWN",
    approvalsPath: values.approvals ?? resolve(process.cwd(), "docs", "grace", "approvals.log"),
    handoff,
    branchSpec,
  };
}

function resolveGovernanceFile(input: string, directory: "handoffs" | "cwo"): string {
  const directPath = resolve(input);
  if (existsSync(directPath)) {
    return directPath;
  }

  const namedPath = resolve(process.cwd(), "docs", "grace", directory, `${input}.xml`);
  if (existsSync(namedPath)) {
    return namedPath;
  }

  const governanceDir = resolve(process.cwd(), "docs", "grace", directory);
  const prefixMatches = readdirSync(governanceDir)
    .filter((entry) => entry.startsWith(input) && entry.endsWith(".xml"))
    .map((entry) => resolve(governanceDir, entry));
  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }
  if (prefixMatches.length > 1) {
    console.error(`PATCH_ERROR: Governance artifact prefix is ambiguous: ${input}`);
    process.exit(2);
  }

  console.error(`PATCH_ERROR: Governance artifact not found: ${input}`);
  process.exit(2);
}

function extractAttributeId(xml: string, rootTag: "GRACE_HANDOFF" | "BRANCH_SPEC"): string {
  const match = xml.match(new RegExp(`<${rootTag}[^>]*\\sid="([^"]+)"`, "i"));
  if (!match) {
    console.error(`PATCH_ERROR: Could not read id from ${rootTag} artifact.`);
    process.exit(2);
  }
  return match[1];
}

function extractElementText(xml: string, elementName: string): string | undefined {
  const match = xml.match(new RegExp(`<${elementName}>([^<]+)</${elementName}>`, "i"));
  return match?.[1]?.trim();
}

function extractScopeIds(xml: string, tagName: "ModuleContractRef" | "FunctionContractRef" | "BlockAnchorRef"): Set<string> {
  return new Set(
    [...xml.matchAll(new RegExp(`<${tagName}\\s+id="([^"]+)"\\s*/>`, "g"))].map((match) => match[1]),
  );
}

function loadGovernanceScope(
  input: string,
  directory: "handoffs" | "cwo",
  rootTag: "GRACE_HANDOFF" | "BRANCH_SPEC",
): GovernanceScope {
  const filePath = resolveGovernanceFile(input, directory);
  const xml = readFileSync(filePath, "utf-8");
  return {
    filePath,
    refId: extractAttributeId(xml, rootTag),
    handoffRef: extractElementText(xml, "HandoffRef"),
    moduleContracts: extractScopeIds(xml, "ModuleContractRef"),
    functionContracts: extractScopeIds(xml, "FunctionContractRef"),
    blockAnchors: extractScopeIds(xml, "BlockAnchorRef"),
  };
}

function parseSemanticMarkers(source: string): SemanticMarker[] {
  const markers: SemanticMarker[] = [];
  const lines = source.split("\n");
  const patterns: Array<{ type: SemanticMarker["type"]; regex: RegExp }> = [
    { type: "MC", regex: /<MODULE_CONTRACT\s+id="(MC-[A-Za-z0-9_-]+)"/g },
    { type: "FC", regex: /<FUNCTION_CONTRACT\s+id="(FC-[A-Za-z0-9_-]+)"/g },
    { type: "BA", regex: /<BLOCK_ANCHOR\s+id="(BA-[A-Za-z0-9_-]+)"/g },
  ];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(lines[lineIndex])) !== null) {
        markers.push({ type: pattern.type, id: match[1], line: lineIndex + 1 });
      }
    }
  }

  return markers.sort((left, right) => left.line - right.line);
}

function resolveSemanticContext(source: string, anchorId: string): { mcId?: string; fcId?: string } {
  const markers = parseSemanticMarkers(source);
  const anchorMarker = markers.find((marker) => marker.type === "BA" && marker.id === anchorId);
  if (!anchorMarker) {
    console.error(`PATCH_ERROR: Anchor "${anchorId}" is not represented as a semantic marker in the target file.`);
    process.exit(2);
  }

  const moduleMarker = markers.filter((marker) => marker.type === "MC" && marker.line < anchorMarker.line).at(-1);
  const functionMarker = markers.filter((marker) => marker.type === "FC" && marker.line < anchorMarker.line).at(-1);
  return { mcId: moduleMarker?.id, fcId: functionMarker?.id };
}

function assertScopeContains(scope: GovernanceScope, anchorId: string, context: { mcId?: string; fcId?: string }, label: string): void {
  if (scope.blockAnchors.size > 0 && !scope.blockAnchors.has(anchorId)) {
    console.error(`PATCH_REFUSED: ${label} ${scope.refId} does not authorize anchor ${anchorId}.`);
    process.exit(5);
  }
  if (context.fcId && scope.functionContracts.size > 0 && !scope.functionContracts.has(context.fcId)) {
    console.error(`PATCH_REFUSED: ${label} ${scope.refId} does not authorize function contract ${context.fcId}.`);
    process.exit(5);
  }
  if (context.mcId && scope.moduleContracts.size > 0 && !scope.moduleContracts.has(context.mcId)) {
    console.error(`PATCH_REFUSED: ${label} ${scope.refId} does not authorize module contract ${context.mcId}.`);
    process.exit(5);
  }
}

function authorizePatch(args: PatchArgs, source: string): GovernanceScope {
  const handoffScope = loadGovernanceScope(args.handoff, "handoffs", "GRACE_HANDOFF");
  const branchSpecScope = loadGovernanceScope(args.branchSpec, "cwo", "BRANCH_SPEC");

  if (branchSpecScope.handoffRef !== handoffScope.refId) {
    console.error(
      `PATCH_REFUSED: BranchSpec ${branchSpecScope.refId} targets ${branchSpecScope.handoffRef ?? "UNKNOWN"}, expected ${handoffScope.refId}.`,
    );
    process.exit(5);
  }

  const semanticContext = resolveSemanticContext(source, args.anchor);
  assertScopeContains(handoffScope, args.anchor, semanticContext, "Handoff");
  assertScopeContains(branchSpecScope, args.anchor, semanticContext, "BranchSpec");

  if (args.dryRun) {
    return handoffScope;
  }

  if (!existsSync(args.approvalsPath)) {
    console.error(
      `PATCH_REFUSED: approvals.log not found at ${args.approvalsPath}.\n` +
      "A human must add a GRACE_APPROVAL entry before patches can be applied.",
    );
    process.exit(5);
  }

  const log = readFileSync(args.approvalsPath, "utf-8");
  const approvalPattern = new RegExp(
    `<GRACE_APPROVAL[\\s\\n]+ref="${escapeRegExp(handoffScope.refId)}"[\\s\\n]+status="APPROVED"`,
    "m",
  );

  if (!approvalPattern.test(log)) {
    console.error(
      `PATCH_REFUSED: No approval found in approvals.log for ${handoffScope.refId}.\n` +
      `A human must add a <GRACE_APPROVAL ref="${handoffScope.refId}" status="APPROVED" .../> entry to docs/grace/approvals.log before this tool can apply patches.`,
    );
    process.exit(5);
  }

  return handoffScope;
}

function findAnchorBlock(source: string, anchorId: string): AnchorRegion {
  const escapedId = escapeRegExp(anchorId);

  const selfClosingRegex = new RegExp(`\\/\\*\\s*<BLOCK_ANCHOR\\s+id="${escapedId}"[^>]*\\/>\\s*\\*\\/`, "g");
  const pairedRegex = new RegExp(`\\/\\*\\s*<BLOCK_ANCHOR\\s+id="${escapedId}"\\s+[^>]*[^/]\\>\\s*\\*\\/`, "g");

  const selfClosingMatches: { index: number; length: number }[] = [];
  const pairedMatches: { index: number; length: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = selfClosingRegex.exec(source)) !== null) {
    selfClosingMatches.push({ index: match.index, length: match[0].length });
  }

  while ((match = pairedRegex.exec(source)) !== null) {
    pairedMatches.push({ index: match.index, length: match[0].length });
  }

  const totalMatches = selfClosingMatches.length + pairedMatches.length;
  if (totalMatches === 0) {
    console.error(`PATCH_ERROR: Anchor "${anchorId}" not found in file.`);
    process.exit(2);
  }
  if (totalMatches > 1) {
    console.error(`PATCH_ERROR: Ambiguous anchor "${anchorId}" found ${totalMatches} times in file.`);
    process.exit(2);
  }

  if (pairedMatches.length === 1) {
    const open = pairedMatches[0];
    const openEnd = open.index + open.length;
    const closeTagRegex = /\/\*\s*<\/BLOCK_ANCHOR>\s*\*\//g;
    closeTagRegex.lastIndex = openEnd;
    const closeMatch = closeTagRegex.exec(source);
    if (!closeMatch) {
      console.error(`PATCH_ERROR: Found open tag for "${anchorId}" but no closing </BLOCK_ANCHOR> tag.`);
      process.exit(2);
    }
    return {
      openStart: open.index,
      openEnd,
      closeStart: closeMatch.index,
      closeEnd: closeMatch.index + closeMatch[0].length,
      isPaired: true,
    };
  }

  const selfClose = selfClosingMatches[0];
  const markerEnd = selfClose.index + selfClose.length;
  const extent = detectStatementExtent(source, markerEnd);
  if (!extent) {
    console.error(
      `PATCH_ERROR: Could not detect statement extent after self-closing anchor "${anchorId}".\n` +
      "Consider converting the marker to paired format.",
    );
    process.exit(2);
  }

  return {
    openStart: selfClose.index,
    openEnd: markerEnd,
    closeStart: extent.end,
    closeEnd: extent.end,
    isPaired: false,
  };
}

function detectStatementExtent(source: string, startPos: number): { end: number } | null {
  let pos = startPos;
  while (pos < source.length && /\s/.test(source[pos])) {
    pos++;
  }
  if (pos >= source.length) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let stringChar = "";

  for (let index = pos; index < source.length; index++) {
    const ch = source[index];

    if (inString) {
      if (ch === "\\") {
        index++;
        continue;
      }
      if (ch === stringChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth <= 0) {
        return { end: index + 1 };
      }
      continue;
    }
    if (ch === ";" && depth === 0) {
      return { end: index + 1 };
    }
  }

  return { end: source.length };
}

function buildReplacement(source: string, region: AnchorRegion, newCode: string): string {
  const prefix = source.slice(0, region.openEnd);
  const suffix = source.slice(region.closeStart);
  return `${prefix}\n${newCode}\n${suffix}`;
}

function validateReplacementScope(newCode: string, anchorId: string): ReplacementScopeIssue[] {
  const issues: ReplacementScopeIssue[] = [];

  if (/<\/?BLOCK_ANCHOR\b/.test(newCode)) {
    issues.push({
      code: "PATCH_SCOPE_BLOCK_TAG",
      detail: "replacement code must not inject BLOCK_ANCHOR open/close tags inside the anchored region",
    });
  }

  if (/<MODULE_CONTRACT\b|<FUNCTION_CONTRACT\b/.test(newCode)) {
    issues.push({
      code: "PATCH_SCOPE_CONTRACT_TAG",
      detail: "replacement code must not inject MODULE_CONTRACT or FUNCTION_CONTRACT tags inside the anchored region",
    });
  }

  const foreignAnchors = [...newCode.matchAll(/\b(BA-[A-Za-z0-9_-]+)\b/g)]
    .map((match) => match[1])
    .filter((id) => id !== anchorId);
  if (foreignAnchors.length > 0) {
    issues.push({
      code: "PATCH_SCOPE_FOREIGN_BA",
      detail: `replacement code references foreign block anchors: ${Array.from(new Set(foreignAnchors)).join(", ")}`,
    });
  }

  return issues;
}

function validateContracts(newSource: string): ContractError[] {
  const errors: ContractError[] = [];

  const mcOpenCount = (newSource.match(/<MODULE_CONTRACT\s+id="[^"]+"/g) ?? []).length;
  const mcCloseCount = (newSource.match(/<\/MODULE_CONTRACT>/g) ?? []).length;
  if (mcOpenCount !== mcCloseCount) {
    errors.push({ contractId: "MODULE_CONTRACT", issue: `Unbalanced tags: ${mcOpenCount} open, ${mcCloseCount} close` });
  }

  const mcOpenTags = newSource.match(/<MODULE_CONTRACT\s+id="[^"]+"[^>]*>/g) ?? [];
  for (const tag of mcOpenTags) {
    if (!/version="/.test(tag)) {
      const idMatch = tag.match(/id="([^"]+)"/);
      errors.push({ contractId: idMatch?.[1] ?? "MODULE_CONTRACT", issue: "Missing required version attribute" });
    }
  }

  const fcOpenCount = (newSource.match(/<FUNCTION_CONTRACT\s+id="[^"]+"/g) ?? []).length;
  const fcCloseCount = (newSource.match(/<\/FUNCTION_CONTRACT>/g) ?? []).length;
  if (fcOpenCount !== fcCloseCount) {
    errors.push({ contractId: "FUNCTION_CONTRACT", issue: `Unbalanced tags: ${fcOpenCount} open, ${fcCloseCount} close` });
  }

  const baPairedOpen = newSource.match(/^\s*\/\*\s*<BLOCK_ANCHOR\s+id="[^"]+"[^>]*[^/]>\s*\*\/\s*$/gm) ?? [];
  const baSelfClosing = newSource.match(/^\s*\/\*\s*<BLOCK_ANCHOR\s+id="[^"]+"[^>]*\/>\s*\*\/\s*$/gm) ?? [];
  const baOpenCount = baPairedOpen.length;
  const baCloseCount = (newSource.match(/^\s*\/\*\s*<\/BLOCK_ANCHOR>\s*\*\/\s*$/gm) ?? []).length;
  if (baOpenCount !== baCloseCount) {
    errors.push({
      contractId: "BLOCK_ANCHOR",
      issue: `Unbalanced tags: ${baOpenCount} paired open, ${baSelfClosing.length} self-closing, ${baCloseCount} close`,
    });
  }

  const contractBaRefs = [...newSource.matchAll(/<BA\s+ref="(BA-[\w-]+)"\s*\/>/g)];
  for (const ref of contractBaRefs) {
    const baId = ref[1];
    if (!new RegExp(`<BLOCK_ANCHOR\\s+id="${escapeRegExp(baId)}"`).test(newSource)) {
      errors.push({ contractId: baId, issue: "Referenced in contract but BLOCK_ANCHOR marker missing from code" });
    }
  }

  return errors;
}

function generateDiff(original: string, modified: string, filePath: string): string {
  const originalLines = original.split("\n");
  const modifiedLines = modified.split("\n");

  try {
    const origTmp = `${filePath}.grace-patch-orig-tmp`;
    const modTmp = `${filePath}.grace-patch-mod-tmp`;
    writeFileSync(origTmp, original, "utf-8");
    writeFileSync(modTmp, modified, "utf-8");
    try {
      const result = execFileSync("git", ["diff", "--no-index", "--unified=3", origTmp, modTmp], {
        encoding: "utf-8",
        timeout: 5000,
      });
      return result
        .replace(new RegExp(escapeRegExp(origTmp), "g"), `a/${filePath}`)
        .replace(new RegExp(escapeRegExp(modTmp), "g"), `b/${filePath}`);
    } finally {
      try { unlinkSync(origTmp); } catch {}
      try { unlinkSync(modTmp); } catch {}
    }
  } catch {
    return generateBuiltinDiff(originalLines, modifiedLines, filePath);
  }
}

function generateBuiltinDiff(originalLines: string[], modifiedLines: string[], filePath: string): string {
  const output: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  const lcs = computeLCS(originalLines, modifiedLines);
  let origIdx = 0;
  let modIdx = 0;
  let lcsIdx = 0;
  const hunks: { origStart: number; modStart: number; lines: string[] }[] = [];
  let currentHunk: { origStart: number; modStart: number; lines: string[] } | null = null;

  while (origIdx < originalLines.length || modIdx < modifiedLines.length) {
    if (
      lcsIdx < lcs.length &&
      origIdx < originalLines.length &&
      modIdx < modifiedLines.length &&
      originalLines[origIdx] === lcs[lcsIdx] &&
      modifiedLines[modIdx] === lcs[lcsIdx]
    ) {
      if (currentHunk) {
        currentHunk.lines.push(` ${originalLines[origIdx]}`);
      }
      origIdx++;
      modIdx++;
      lcsIdx++;
      continue;
    }

    if (origIdx < originalLines.length && (lcsIdx >= lcs.length || originalLines[origIdx] !== lcs[lcsIdx])) {
      if (!currentHunk) {
        currentHunk = { origStart: origIdx + 1, modStart: modIdx + 1, lines: [] };
        hunks.push(currentHunk);
      }
      currentHunk.lines.push(`-${originalLines[origIdx]}`);
      origIdx++;
      continue;
    }

    if (modIdx < modifiedLines.length && (lcsIdx >= lcs.length || modifiedLines[modIdx] !== lcs[lcsIdx])) {
      if (!currentHunk) {
        currentHunk = { origStart: origIdx + 1, modStart: modIdx + 1, lines: [] };
        hunks.push(currentHunk);
      }
      currentHunk.lines.push(`+${modifiedLines[modIdx]}`);
      modIdx++;
      continue;
    }

    currentHunk = null;
    origIdx++;
    modIdx++;
    lcsIdx++;
  }

  for (const hunk of hunks) {
    const origCount = hunk.lines.filter((line) => !line.startsWith("+")).length;
    const modCount = hunk.lines.filter((line) => !line.startsWith("-")).length;
    output.push(`@@ -${hunk.origStart},${origCount} +${hunk.modStart},${modCount} @@`);
    output.push(...hunk.lines);
  }

  return `${output.join("\n")}\n`;
}

function computeLCS(left: string[], right: string[]): string[] {
  const matrix: number[][] = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));

  for (let row = 1; row <= left.length; row++) {
    for (let col = 1; col <= right.length; col++) {
      matrix[row][col] = left[row - 1] === right[col - 1]
        ? matrix[row - 1][col - 1] + 1
        : Math.max(matrix[row - 1][col], matrix[row][col - 1]);
    }
  }

  const result: string[] = [];
  let row = left.length;
  let col = right.length;
  while (row > 0 && col > 0) {
    if (left[row - 1] === right[col - 1]) {
      result.unshift(left[row - 1]);
      row--;
      col--;
    } else if (matrix[row - 1][col] > matrix[row][col - 1]) {
      row--;
    } else {
      col--;
    }
  }

  return result;
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = `${filePath}.grace-patch-tmp`;
  try {
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, filePath);
  } catch (error) {
    try { unlinkSync(tmpPath); } catch {}
    throw error;
  }
}

/*
 * <FUNCTION_CONTRACT id="FC-grace-patch-executePatch">
 *   <Intent>Orchestrate the full patch lifecycle: parse args, authorize scope, find anchor, replace code, validate, apply or show diff.</Intent>
 *   <Inputs>
 *     <Input name="argv">Raw CLI argument array.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="exitCode">0 success, 1 noop, 2-5 error.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-PATCH-ARGPARSE"/>
 *     <BA ref="BA-PATCH-APPROVAL"/>
 *     <BA ref="BA-PATCH-FIND"/>
 *     <BA ref="BA-PATCH-REPLACE"/>
 *     <BA ref="BA-PATCH-VALIDATE"/>
 *     <BA ref="BA-PATCH-DRYRUN"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
function executePatch(argv: string[]): void {
  /* <BLOCK_ANCHOR id="BA-PATCH-ARGPARSE" purpose="Parse CLI arguments into PatchArgs" /> */
  const args = parsePatchArgs(argv);
  const source = readFileSync(args.file, "utf-8");

  /* <BLOCK_ANCHOR id="BA-PATCH-APPROVAL" purpose="Verify approval exists and scope is authorized before applying patch" /> */
  authorizePatch(args, source);

  /* <BLOCK_ANCHOR id="BA-PATCH-FIND" purpose="Locate paired or self-closing BLOCK_ANCHOR by BA id" /> */
  const region = findAnchorBlock(source, args.anchor);
  /* <BLOCK_ANCHOR id="BA-PATCH-REPLACE" purpose="Construct new file content with replacement between anchor markers" /> */
  const replacementScopeIssues = validateReplacementScope(args.code, args.anchor);
  if (replacementScopeIssues.length > 0) {
    console.error("PATCH_ERROR: Replacement violates semantic patch-scope rules:");
    for (const issue of replacementScopeIssues) {
      console.error(`  - ${issue.code}: ${issue.detail}`);
    }
    process.exit(4);
  }
  const newSource = buildReplacement(source, region, args.code);

  if (newSource === source) {
    console.log("PATCH_NOOP: Replacement code is identical to current content. No change needed.");
    process.exit(1);
  }

  /* <BLOCK_ANCHOR id="BA-PATCH-VALIDATE" purpose="Validate MC FC BA structure remains balanced after patch" /> */
  const contractErrors = validateContracts(newSource);
  if (contractErrors.length > 0) {
    console.error("PATCH_ERROR: Contract validation failed:");
    for (const error of contractErrors) {
      console.error(`  - ${error.contractId}: ${error.issue}`);
    }
    process.exit(4);
  }

  if (args.dryRun) {
    /* <BLOCK_ANCHOR id="BA-PATCH-DRYRUN" purpose="Generate unified diff for dry-run mode" /> */
    const diff = generateDiff(source, newSource, args.file);
    if (diff.trim() === "") {
      console.log("PATCH_NOOP: No differences detected.");
      process.exit(1);
    }
    process.stdout.write(diff);
    process.exit(0);
  }

  atomicWrite(args.file, newSource);
  console.log(`PATCH_OK: ${args.file} patched at ${args.anchor}.`);
  process.exit(0);
}

const isMain = process.argv[1] === resolve(process.argv[1] ?? "");
if (isMain) {
  executePatch(process.argv.slice(2));
}
