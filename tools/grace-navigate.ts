#!/usr/bin/env npx tsx
/**
 * <!-- MODULE_MAP id="MM-grace-navigate" -->
 * <Layers>
 *   <Layer name="domain" package="tools/grace-navigate.ts">
 *     Pure parsing: regex extraction of markers, graph node/edge construction.
 *     No side effects, no I/O beyond receiving source strings.
 *   </Layer>
 *   <Layer name="application" package="tools/grace-navigate.ts">
 *     Orchestration: CLI argument dispatch (mode selection), file scanning,
 *     graph query execution, output formatting (tree, Mermaid).
 *   </Layer>
 *   <Layer name="infrastructure" package="tools/grace-navigate.ts">
 *     File system access: glob-based source file discovery, stdout emission.
 *     Node.js fs/path module binding.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="DevelopmentPlan.xml#DP-SVC-demo-http"/>
 *   <Link ref="DevelopmentExecutionPlan.xml#W2-T1"/>
 *   <Link ref="GRACE_MARKUP_STANDARD.md"/>
 * </Links>
 * <!-- /MODULE_MAP -->
 */

/**
 * <MODULE_CONTRACT id="MC-grace-navigate-application-GraceNavigate" version="1.0.0">
 *   <Purpose>
 *     CLI tool for navigating the GRACE semantic hierarchy (MM → MC → FC → BA).
 *     Parses source files for MODULE_MAP, MODULE_CONTRACT, FUNCTION_CONTRACT, and
 *     BLOCK_ANCHOR markers, builds an in-memory graph, and provides query modes
 *     for hierarchical traversal and visualization.
 *   </Purpose>
 *   <Responsibilities>
 *     <Item>Discover and parse all GRACE semantic markers from TypeScript source files via regex</Item>
 *     <Item>Build an in-memory directed graph: MM → MC → FC → BA</Item>
 *     <Item>Support query modes: --by-anchor (code location), --by-usecase (contract discovery), --graph (Mermaid export)</Item>
 *     <Item>Output semantic hierarchy as indented tree or Mermaid diagram</Item>
 *   </Responsibilities>
 *   <Invariants>
 *     <I1>All regex patterns must match the canonical ID formats from GRACE_MARKUP_STANDARD.md Section 5.2</I1>
 *     <I2>The graph is acyclic: MM → MC → FC → BA hierarchy is strictly layered</I2>
 *     <I3>Each marker ID is unique within the scanned corpus; duplicates are reported as warnings</I3>
 *     <I4>Parsing is pure: given identical source inputs, the graph is deterministic</I4>
 *   </Invariants>
 *   <Collaborators>
 *     <Item>reads: source files under src directory containing GRACE markers</Item>
 *     <Item>references: GRACE_MARKUP_STANDARD.md (ID pattern definitions)</Item>
 *   </Collaborators>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W2-T1"/>
 *     <Link ref="DevelopmentPlan.xml#DP-SVC-demo-http"/>
 *     <Link ref="GRACE_MARKUP_STANDARD.md"/>
 *   </Links>
 * </MODULE_CONTRACT>
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

interface ParsedMarker {
  type: "MM" | "MC" | "FC" | "BA";
  id: string;
  file: string;
  line: number;
}

interface GraphNode {
  id: string;
  type: "MM" | "MC" | "FC" | "BA";
  file: string;
  line: number;
  children: string[];
  links: string[];
}

interface Edge {
  from: string;
  to: string;
}

interface NavigationGraph {
  nodes: Map<string, GraphNode>;
  edges: Edge[];
  ucIndex: Map<string, string[]>;
  duplicateIds: string[];
}

interface CliArgs {
  dir: string;
  glob: string;
  byAnchor?: string;
  byContract?: string;
  logToken?: string;
  byUsecase?: string;
  graph: boolean;
  json: boolean;
  registryOut?: string;
  validateRegistry: boolean;
}

type GraphIssueKind = "DUPLICATE_ID" | "ORPHAN_FC" | "ORPHAN_BA" | "BROKEN_REFERENCE";

interface GraphIntegrityIssue {
  kind: GraphIssueKind;
  severity: "BLOCKING" | "NONBLOCKING";
  nodeId: string;
  file: string;
  detail: string;
}

interface GraphRegistryNode {
  id: string;
  type: "UC" | ParsedMarker["type"];
  file: string;
  line: number;
  links: string[];
  children: string[];
}

interface GraphRegistryEdge {
  from: string;
  to: string;
  kind: "CONTAINS" | "REFERENCES";
}

interface GraphRegistry {
  schemaVersion: "grace-graph-registry-v1";
  generatedAt: string;
  sourceRoot: string;
  summary: {
    nodeCount: number;
    edgeCount: number;
    duplicateCount: number;
    issueCount: number;
    ucCount: number;
    fileCount: number;
  };
  nodes: GraphRegistryNode[];
  edges: GraphRegistryEdge[];
  ucIndex: Record<string, string[]>;
  issues: GraphIntegrityIssue[];
}

// ── Infrastructure: File scanning ──────────────────────────────────────────

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

// ── Domain: Marker parsing ─────────────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-grace-navigate-UC-NAVIGATE-parseMarkers">
 *   <Intent>
 *     Extract all GRACE semantic markers (MODULE_MAP, MODULE_CONTRACT, FUNCTION_CONTRACT,
 *     BLOCK_ANCHOR) from a single source file string using regex patterns.
 *   </Intent>
 *   <Inputs>
 *     <Input name="source">Full text content of a TypeScript source file (string)</Input>
 *     <Input name="filePath">Relative path of the file for location attribution (string)</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="markers">Array of ParsedMarker objects: { type: 'MM'|'MC'|'FC'|'BA', id: string, file: string, line: number }</Output>
 *   </Outputs>
 *   <Preconditions>
 *     <Item>source is a non-empty string</Item>
 *     <Item>filePath is a valid relative path from repo root</Item>
 *   </Preconditions>
 *   <Postconditions>
 *     <Item>All MM-*, MC-*, FC-*, BA-* IDs in the source are represented in markers array</Item>
 *     <Item>Each marker carries the correct file and line number</Item>
 *     <Item>Markers are returned in file-line order</Item>
 *   </Postconditions>
 *   <ErrorHandling>
 *     <Item code="ERR-NAV-PARSE-01">Malformed marker syntax (unclosed tag, missing id attribute) → skip with warning to stderr</Item>
 *   </ErrorHandling>
 *   <BlockAnchors>
 *     <BA ref="BA-NAV-PARSE-01">Match MODULE_MAP / MODULE_CONTRACT comment blocks (multi-line JSDoc)</BA>
 *     <BA ref="BA-NAV-PARSE-02">Match FUNCTION_CONTRACT comment blocks and BLOCK_ANCHOR inline comments</BA>
 *   </BlockAnchors>
 *   <Tests>
 *     <TC id="TC-NAV-001">Source with one MODULE_CONTRACT and two BLOCK_ANCHORs returns 3 markers</TC>
 *     <TC id="TC-NAV-002">Source with no markers returns empty array</TC>
 *     <TC id="TC-NAV-003">Marker IDs match canonical patterns MM-*, MC-*, FC-*, BA-*</TC>
 *   </Tests>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W2-T1"/>
 *     <Link ref="GRACE_MARKUP_STANDARD.md#5.2"/>
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
function parseMarkers(source: string, filePath: string): ParsedMarker[] {
  const markers: ParsedMarker[] = [];
  const lines = source.split("\n");
  const seen = new Set<string>();

  /* <BLOCK_ANCHOR id="BA-NAV-PARSE-01" purpose="Match MODULE_MAP / MODULE_CONTRACT comment blocks" /> */
  // MODULE_MAP: <!-- MODULE_MAP id="MM-..." -->
  const mmRegex = /<!--\s*MODULE_MAP\s+id="(MM-[A-Za-z0-9_-]+)"\s*-->/g;
  // MODULE_CONTRACT: <MODULE_CONTRACT id="MC-..." ...>
  const mcRegex = /<MODULE_CONTRACT\s+id="(MC-[A-Za-z0-9_-]+)"/g;
  // FUNCTION_CONTRACT: <FUNCTION_CONTRACT id="FC-..." ...>
  const fcRegex = /<FUNCTION_CONTRACT\s+id="(FC-[A-Za-z0-9_-]+)"/g;

  /* <BLOCK_ANCHOR id="BA-NAV-PARSE-02" purpose="Match FUNCTION_CONTRACT comment blocks and BLOCK_ANCHOR inline comments" /> */
  // BLOCK_ANCHOR: <BLOCK_ANCHOR id="BA-..." ...>
  const baRegex = /<BLOCK_ANCHOR\s+id="(BA-[A-Za-z0-9_-]+)"/g;

  // Const-assignment variant: const MM_... = "MM-...", const MC_... = "MC-...", etc.
  const constRegex = /const\s+(MM_|MC_|FC_|BA_)[A-Za-z0-9_]+\s*=\s*"([A-Z][A-Za-z0-9_-]+)"/g;

  // First pass: collect JSDoc/XML markers (these have precise line locations)
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

  // Second pass: collect const-assignment markers only if no JSDoc marker was found
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

// ── Domain: Graph construction ─────────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-grace-navigate-UC-NAVIGATE-buildGraph">
 *   <Intent>
 *     Construct an in-memory directed graph from parsed markers.
 *     Edges: MM → MC (contract belongs to map), MC → FC (function belongs to contract),
 *     FC → BA (block belongs to function). Also links FC/MC to UC-* via LINK parsing.
 *   </Intent>
 *   <Inputs>
 *     <Input name="allMarkers">Array of ParsedMarker from all scanned files</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="graph">NavigationGraph: { nodes: Map&lt;id, Node&gt;, edges: Edge[], ucIndex: Map&lt;ucId, fcId[]&gt; }</Output>
 *   </Outputs>
 *   <Preconditions>
 *     <Item>allMarkers has been produced by parseMarkers across all target files</Item>
 *   </Preconditions>
 *   <Postconditions>
 *     <Item>Every marker is a node in the graph</Item>
 *     <Item>MM→MC edges established by containment (MC appears inside MM scope or same file)</Item>
 *     <Item>MC→FC edges established by FUNCTION_CONTRACT placement rules (FC immediately above method in same file as MC)</Item>
 *     <Item>FC→BA edges established by BLOCK_ANCHOR references in FC's BlockAnchors section</Item>
 *     <Item>ucIndex maps each UC-* to its owning FC(s) via LINK parsing</Item>
 *   </Postconditions>
 *   <ErrorHandling>
 *     <Item code="ERR-NAV-GRAPH-01">Orphan FC (no parent MC) → attach to nearest MC in same file or warn</Item>
 *     <Item code="ERR-NAV-GRAPH-02">Orphan BA (no parent FC) → attach to nearest FC above in same file or warn</Item>
 *   </ErrorHandling>
 *   <BlockAnchors>
 *     <BA ref="BA-NAV-GRAPH-01">Edge construction: resolve parent-child relationships from marker positions and LINK metadata</BA>
 *   </BlockAnchors>
 *   <Tests>
 *     <TC id="TC-NAV-004">Given markers from server.ts: graph contains MM-demo-http → MC-demo-http → FC-demo-handleRequest → BA-demo-*</TC>
 *   </Tests>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W2-T1"/>
 *     <Link ref="GRACE_MARKUP_STANDARD.md#5.3"/>
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
function buildGraph(allMarkers: ParsedMarker[]): NavigationGraph {
  /* <BLOCK_ANCHOR id="BA-NAV-GRAPH-01" purpose="Edge construction: resolve parent-child relationships from marker positions and LINK metadata" /> */
  const nodes = new Map<string, GraphNode>();
  const edges: Edge[] = [];
  const ucIndex = new Map<string, string[]>();
  const duplicateIds: string[] = [];

  // Create nodes
  for (const marker of allMarkers) {
    if (nodes.has(marker.id)) {
      const existing = nodes.get(marker.id);
      if (existing && existing.type !== "MM" && existing.type !== "MC") {
        duplicateIds.push(marker.id);
      }
      continue;
    }

    nodes.set(marker.id, {
      id: marker.id,
      type: marker.type,
      file: marker.file,
      line: marker.line,
      children: [],
      links: [],
    });
  }

  // Build file→markers index for positional edge inference
  const fileMarkers = new Map<string, ParsedMarker[]>();
  for (const marker of allMarkers) {
    const list = fileMarkers.get(marker.file) ?? [];
    list.push(marker);
    fileMarkers.set(marker.file, list);
  }

  // For each file, build edges based on marker type hierarchy and position
  for (const [, markersInFile] of fileMarkers) {
    const mms = markersInFile.filter((m) => m.type === "MM");
    const mcs = markersInFile.filter((m) => m.type === "MC");
    const fcs = markersInFile.filter((m) => m.type === "FC");
    const bas = markersInFile.filter((m) => m.type === "BA");

    // MM → MC: each MC in the same file belongs to the MM
    for (const mm of mms) {
      for (const mc of mcs) {
        if (!edges.some((e) => e.from === mm.id && e.to === mc.id)) {
          edges.push({ from: mm.id, to: mc.id });
          const node = nodes.get(mm.id);
          if (node) node.children.push(mc.id);
        }
      }
    }

    // MC → FC: each FC in the same file belongs to the nearest MC above it
    for (const fc of fcs) {
      let parentMc: ParsedMarker | undefined;
      for (const mc of mcs) {
        if (mc.line <= fc.line) {
          if (!parentMc || mc.line > parentMc.line) {
            parentMc = mc;
          }
        }
      }
      if (parentMc) {
        if (!edges.some((e) => e.from === parentMc!.id && e.to === fc.id)) {
          edges.push({ from: parentMc.id, to: fc.id });
          const node = nodes.get(parentMc.id);
          if (node) node.children.push(fc.id);
        }
      }
    }

    // FC → BA: each BA belongs to the nearest FC above it
    for (const ba of bas) {
      let parentFc: ParsedMarker | undefined;
      for (const fc of fcs) {
        if (fc.line <= ba.line) {
          if (!parentFc || fc.line > parentFc.line) {
            parentFc = fc;
          }
        }
      }
      if (parentFc) {
        if (!edges.some((e) => e.from === parentFc!.id && e.to === ba.id)) {
          edges.push({ from: parentFc.id, to: ba.id });
          const node = nodes.get(parentFc.id);
          if (node) node.children.push(ba.id);
        }
      }
    }
  }

  // Parse UC-* links from source files and build ucIndex
  for (const [file] of fileMarkers) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const fileMarkerList = fileMarkers.get(file) ?? [];
    const fcMarkers = fileMarkerList.filter((mk) => mk.type === "FC");
    const mcMarkers = fileMarkerList.filter((mk) => mk.type === "MC");

    const ucLinkRegex = /RequirementsAnalysis\.xml#(UC-[A-Za-z0-9_-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = ucLinkRegex.exec(content)) !== null) {
      const ucId = m[1];

      // Associate UC with FC nodes in this file
      for (const fc of fcMarkers) {
        const existing = ucIndex.get(ucId) ?? [];
        if (!existing.includes(fc.id)) {
          existing.push(fc.id);
          ucIndex.set(ucId, existing);
        }
        const node = nodes.get(fc.id);
        if (node && !node.links.includes(ucId)) {
          node.links.push(ucId);
        }
      }

      // Associate UC with MC nodes in this file
      for (const mc of mcMarkers) {
        const node = nodes.get(mc.id);
        if (node && !node.links.includes(ucId)) {
          node.links.push(ucId);
        }
        const existing = ucIndex.get(ucId) ?? [];
        if (!existing.includes(mc.id)) {
          existing.push(mc.id);
          ucIndex.set(ucId, existing);
        }
      }
    }
  }

  return { nodes, edges, ucIndex, duplicateIds };
}

function buildGraphRegistry(graph: NavigationGraph, scannedFiles: string[]): GraphRegistry {
  const registryNodes = new Map<string, GraphRegistryNode>();
  const registryEdges: GraphRegistryEdge[] = [];
  const issues: GraphIntegrityIssue[] = [];

  for (const [, node] of graph.nodes) {
    registryNodes.set(node.id, {
      id: node.id,
      type: node.type,
      file: node.file,
      line: node.line,
      links: [...node.links].sort(),
      children: [...node.children].sort(),
    });
  }

  for (const edge of graph.edges) {
    registryEdges.push({ from: edge.from, to: edge.to, kind: "CONTAINS" });
  }

  for (const duplicateId of new Set(graph.duplicateIds)) {
    issues.push({
      kind: "DUPLICATE_ID",
      severity: "BLOCKING",
      nodeId: duplicateId,
      file: "(multiple files)",
      detail: "semantic id appears more than once in the scanned corpus",
    });
  }

  for (const [ucId] of graph.ucIndex) {
    if (!registryNodes.has(ucId)) {
      registryNodes.set(ucId, {
        id: ucId,
        type: "UC",
        file: "docs/grace/RequirementsAnalysis.xml",
        line: 0,
        links: [],
        children: [],
      });
    }
  }

  for (const [, node] of graph.nodes) {
    for (const linkId of node.links) {
      registryEdges.push({ from: node.id, to: linkId, kind: "REFERENCES" });
      if (!registryNodes.has(linkId)) {
        issues.push({
          kind: "BROKEN_REFERENCE",
          severity: "BLOCKING",
          nodeId: node.id,
          file: node.file,
          detail: `reference target "${linkId}" was not materialized in the registry`,
        });
      }
    }
  }

  for (const [, node] of graph.nodes) {
    if (node.type === "FC") {
      const hasParentMc = graph.edges.some((edge) => edge.to === node.id && graph.nodes.get(edge.from)?.type === "MC");
      if (!hasParentMc) {
        issues.push({
          kind: "ORPHAN_FC",
          severity: "BLOCKING",
          nodeId: node.id,
          file: node.file,
          detail: "FUNCTION_CONTRACT does not have a parent MODULE_CONTRACT edge",
        });
      }
    }

    if (node.type === "BA") {
      const hasParentFc = graph.edges.some((edge) => edge.to === node.id && graph.nodes.get(edge.from)?.type === "FC");
      if (!hasParentFc) {
        issues.push({
          kind: "ORPHAN_BA",
          severity: "BLOCKING",
          nodeId: node.id,
          file: node.file,
          detail: "BLOCK_ANCHOR does not have a parent FUNCTION_CONTRACT edge",
        });
      }
    }
  }

  const nodes = Array.from(registryNodes.values()).sort((a, b) => a.id.localeCompare(b.id));
  const edges = registryEdges.sort((a, b) => `${a.kind}:${a.from}:${a.to}`.localeCompare(`${b.kind}:${b.from}:${b.to}`));
  const ucIndex: Record<string, string[]> = {};
  for (const [ucId, linkedIds] of graph.ucIndex) {
    ucIndex[ucId] = [...linkedIds].sort();
  }

  return {
    schemaVersion: "grace-graph-registry-v1",
    generatedAt: new Date().toISOString(),
    sourceRoot: process.cwd(),
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      duplicateCount: graph.duplicateIds.length,
      issueCount: issues.length,
      ucCount: Object.keys(ucIndex).length,
      fileCount: scannedFiles.length,
    },
    nodes,
    edges,
    ucIndex,
    issues,
  };
}

function writeGraphRegistry(outPath: string, registry: GraphRegistry): string {
  const resolved = resolve(process.cwd(), outPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, JSON.stringify(registry, null, 2) + "\n", "utf-8");
  return resolved;
}

// ── Application: Query modes ───────────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-grace-navigate-UC-NAVIGATE-queryByAnchor">
 *   <Intent>
 *     Given a BA-* anchor ID, return the full hierarchy path from MM down to the
 *     anchored code block, including file location and line number.
 *   </Intent>
 *   <Inputs>
 *     <Input name="anchorId">BLOCK_ANCHOR ID string (e.g., "BA-demo-health")</Input>
 *     <Input name="graph">NavigationGraph built by buildGraph</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="result">TreeNode: { mm: Node, mc: Node, fc: Node, ba: Node, file: string, line: number } | null</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-NAV-QUERY-01">Traverse graph from BA node upward through FC → MC → MM to build full path</BA>
 *   </BlockAnchors>
 *   <Tests>
 *     <TC id="TC-NAV-005">Query BA-demo-health returns path: MM-demo-http → MC-demo-http → FC-demo-handleRequest → BA-demo-health with file=src/server.ts</TC>
 *   </Tests>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W2-T1"/>
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
function queryByAnchor(
  anchorId: string,
  graph: NavigationGraph,
): { mm: GraphNode | null; mc: GraphNode | null; fc: GraphNode | null; ba: GraphNode | null } | null {
  /* <BLOCK_ANCHOR id="BA-NAV-QUERY-01" purpose="Traverse graph from BA node upward through FC → MC → MM to build full path" /> */
  const baNode = graph.nodes.get(anchorId);
  if (!baNode || baNode.type !== "BA") {
    return null;
  }

  // Find parent FC
  let fcNode: GraphNode | null = null;
  for (const edge of graph.edges) {
    if (edge.to === anchorId) {
      const candidate = graph.nodes.get(edge.from);
      if (candidate && candidate.type === "FC") {
        fcNode = candidate;
        break;
      }
    }
  }

  // Find parent MC
  let mcNode: GraphNode | null = null;
  if (fcNode) {
    for (const edge of graph.edges) {
      if (edge.to === fcNode.id) {
        const candidate = graph.nodes.get(edge.from);
        if (candidate && candidate.type === "MC") {
          mcNode = candidate;
          break;
        }
      }
    }
  }

  // Find parent MM
  let mmNode: GraphNode | null = null;
  if (mcNode) {
    for (const edge of graph.edges) {
      if (edge.to === mcNode.id) {
        const candidate = graph.nodes.get(edge.from);
        if (candidate && candidate.type === "MM") {
          mmNode = candidate;
          break;
        }
      }
    }
  }

  return { mm: mmNode, mc: mcNode, fc: fcNode, ba: baNode };
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-navigate-UC-NAVIGATE-queryByUsecase">
 *   <Intent>
 *     Given a UC-* use case ID, find all MODULE_CONTRACT and FUNCTION_CONTRACT nodes
 *     that reference it via their LINK metadata, returning the contract subtree.
 *   </Intent>
 *   <Inputs>
 *     <Input name="usecaseId">Use case ID string (e.g., "UC-DEMO-HTTP-01")</Input>
 *     <Input name="graph">NavigationGraph built by buildGraph</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="result">Array of { mc: Node, fcs: Node[] } — contracts and their functions linked to the UC</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-NAV-QUERY-02">Lookup ucIndex to find FC nodes, then resolve parent MC/MM</BA>
 *   </BlockAnchors>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W2-T1"/>
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
function queryByUsecase(
  usecaseId: string,
  graph: NavigationGraph,
): Array<{ mc: GraphNode; fcs: GraphNode[] }> {
  /* <BLOCK_ANCHOR id="BA-NAV-QUERY-02" purpose="Lookup ucIndex to find FC nodes, then resolve parent MC/MM" /> */
  const linkedIds = graph.ucIndex.get(usecaseId) ?? [];
  const mcToFcs = new Map<string, GraphNode[]>();

  for (const linkedId of linkedIds) {
    const linkedNode = graph.nodes.get(linkedId);
    if (!linkedNode) continue;

    if (linkedNode.type === "FC") {
      // Find parent MC
      for (const edge of graph.edges) {
        if (edge.to === linkedId) {
          const candidate = graph.nodes.get(edge.from);
          if (candidate && candidate.type === "MC") {
            const list = mcToFcs.get(candidate.id) ?? [];
            list.push(linkedNode);
            mcToFcs.set(candidate.id, list);
          }
        }
      }
    } else if (linkedNode.type === "MC") {
      // Direct MC link from MODULE_MAP — list FC children
      const fcChildren: GraphNode[] = [];
      for (const childId of linkedNode.children) {
        const child = graph.nodes.get(childId);
        if (child && child.type === "FC") {
          fcChildren.push(child);
        }
      }
      mcToFcs.set(linkedNode.id, fcChildren);
    }
  }

  const result: Array<{ mc: GraphNode; fcs: GraphNode[] }> = [];
  for (const [mcId, fcs] of mcToFcs) {
    const mcNode = graph.nodes.get(mcId);
    if (mcNode) {
      result.push({ mc: mcNode, fcs });
    }
  }

  return result;
}

function queryByContract(
  contractId: string,
  graph: NavigationGraph,
): { mm: GraphNode | null; mc: GraphNode | null; fc: GraphNode | null; bas: GraphNode[] } | null {
  const node = graph.nodes.get(contractId);
  if (!node) {
    return null;
  }

  if (node.type === "BA") {
    const anchorResult = queryByAnchor(contractId, graph);
    if (!anchorResult || !anchorResult.ba) {
      return null;
    }
    return { mm: anchorResult.mm, mc: anchorResult.mc, fc: anchorResult.fc, bas: [anchorResult.ba] };
  }

  if (node.type === "FC") {
    let mcNode: GraphNode | null = null;
    let mmNode: GraphNode | null = null;
    for (const edge of graph.edges) {
      if (edge.to === node.id) {
        const parent = graph.nodes.get(edge.from);
        if (parent?.type === "MC") {
          mcNode = parent;
          break;
        }
      }
    }
    if (mcNode) {
      for (const edge of graph.edges) {
        if (edge.to === mcNode.id) {
          const parent = graph.nodes.get(edge.from);
          if (parent?.type === "MM") {
            mmNode = parent;
            break;
          }
        }
      }
    }
    const bas = node.children.map((childId) => graph.nodes.get(childId)).filter((child): child is GraphNode => child?.type === "BA");
    return { mm: mmNode, mc: mcNode, fc: node, bas };
  }

  if (node.type === "MC") {
    let mmNode: GraphNode | null = null;
    for (const edge of graph.edges) {
      if (edge.to === node.id) {
        const parent = graph.nodes.get(edge.from);
        if (parent?.type === "MM") {
          mmNode = parent;
          break;
        }
      }
    }
    return { mm: mmNode, mc: node, fc: null, bas: [] };
  }

  if (node.type === "MM") {
    return { mm: node, mc: null, fc: null, bas: [] };
  }

  return null;
}

function resolveLogToken(logToken: string): string | undefined {
  const directMatch = logToken.match(/\b((?:BA|FC|MC)-[A-Za-z0-9_-]+)\b/);
  if (directMatch) {
    return directMatch[1];
  }

  try {
    const parsed = JSON.parse(logToken) as { ba?: string; fc?: string; mc?: string };
    return parsed.ba ?? parsed.fc ?? parsed.mc;
  } catch {
    return undefined;
  }
}

// ── Application: Output formatting ─────────────────────────────────────────

/**
 * <FUNCTION_CONTRACT id="FC-grace-navigate-UC-NAVIGATE-exportMermaid">
 *   <Intent>
 *     Serialize the full navigation graph as a Mermaid flowchart definition
 *     suitable for rendering in Markdown or direct browser preview.
 *   </Intent>
 *   <Inputs>
 *     <Input name="graph">NavigationGraph built by buildGraph</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="mermaid">String containing a valid Mermaid flowchart (graph TD) definition</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-NAV-MERMAID-01">Emit Mermaid nodes and edges: MM as hexagon, MC as rectangle, FC as round-rect, BA as circle</BA>
 *   </BlockAnchors>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W2-T1"/>
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
function exportMermaid(graph: NavigationGraph): string {
  /* <BLOCK_ANCHOR id="BA-NAV-MERMAID-01" purpose="Emit Mermaid nodes and edges: MM as hexagon, MC as rectangle, FC as round-rect, BA as circle" /> */
  const lines: string[] = [];
  lines.push("graph TD");

  // Sanitize ID for Mermaid
  const sanitize = (id: string) => id.replace(/[^A-Za-z0-9_]/g, "_");

  // Emit nodes with shapes
  for (const [, node] of graph.nodes) {
    const sid = sanitize(node.id);
    const label = node.id;
    if (node.type === "MM") {
      lines.push(`  ${sid}{{"${label}"}}`);
    } else if (node.type === "MC") {
      lines.push(`  ${sid}["${label}"]`);
    } else if (node.type === "FC") {
      lines.push(`  ${sid}("${label}")`);
    } else {
      lines.push(`  ${sid}(("${label}"))`);
    }
  }

  // Emit edges
  for (const edge of graph.edges) {
    lines.push(`  ${sanitize(edge.from)} --> ${sanitize(edge.to)}`);
  }

  return lines.join("\n");
}

function printTree(graph: NavigationGraph): void {
  // Find root MM nodes
  const rootMMs: GraphNode[] = [];
  for (const [, node] of graph.nodes) {
    if (node.type === "MM") {
      rootMMs.push(node);
    }
  }

  rootMMs.sort((a, b) => a.id.localeCompare(b.id));

  for (const mm of rootMMs) {
    console.log(mm.id);
    printTreeNode(graph, mm.id, 1);
  }
}

function printTreeNode(graph: NavigationGraph, nodeId: string, depth: number): void {
  const node = graph.nodes.get(nodeId);
  if (!node) return;

  const indent = "  ".repeat(depth);

  for (const childId of node.children) {
    const child = graph.nodes.get(childId);
    if (!child) continue;

    if (child.type === "BA") {
      console.log(`${indent}${child.id}  (${child.file}:${child.line})`);
    } else {
      console.log(`${indent}${child.id}`);
    }

    printTreeNode(graph, childId, depth + 1);
  }
}

function printAnchorResult(
  result: { mm: GraphNode | null; mc: GraphNode | null; fc: GraphNode | null; ba: GraphNode | null },
): void {
  if (!result) {
    console.log("(anchor not found)");
    return;
  }
  if (result.mm) console.log(result.mm.id);
  if (result.mc) console.log(`  ${result.mc.id}`);
  if (result.fc) console.log(`  ${result.fc.id}`);
  if (result.ba) console.log(`  ${result.ba.id}  (${result.ba.file}:${result.ba.line})`);
}

function printUsecaseResult(results: Array<{ mc: GraphNode; fcs: GraphNode[] }>): void {
  if (results.length === 0) {
    console.log("(no contracts linked to this use case)");
    return;
  }
  for (const { mc, fcs } of results) {
    console.log(mc.id);
    for (const fc of fcs) {
      console.log(`  ${fc.id}  (${fc.file}:${fc.line})`);
    }
  }
}

function printContractResult(
  result: { mm: GraphNode | null; mc: GraphNode | null; fc: GraphNode | null; bas: GraphNode[] } | null,
): void {
  if (!result) {
    console.log("(contract not found)");
    return;
  }
  if (result.mm) console.log(result.mm.id);
  if (result.mc) console.log(`  ${result.mc.id}`);
  if (result.fc) console.log(`  ${result.fc.id}`);
  for (const ba of result.bas) {
    console.log(`    ${ba.id}  (${ba.file}:${ba.line})`);
  }
}

// ── Application: CLI argument parsing ──────────────────────────────────────

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dir: ".",
    glob: ".ts",
    graph: false,
    json: false,
    validateRegistry: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--dir") {
      args.dir = argv[++i] ?? args.dir;
      i++;
    } else if (arg === "--glob") {
      const pattern = argv[++i] ?? "";
      // Extract extension from glob pattern (e.g., "*.ts" → ".ts")
      const extMatch = pattern.match(/\*(\.\w+)$/);
      if (extMatch) {
        args.glob = extMatch[1];
      }
      i++;
    } else if (arg === "--by-anchor") {
      args.byAnchor = argv[++i];
      i++;
    } else if (arg === "--by-contract") {
      args.byContract = argv[++i];
      i++;
    } else if (arg === "--log-token") {
      args.logToken = argv[++i];
      i++;
    } else if (arg === "--by-usecase") {
      args.byUsecase = argv[++i];
      i++;
    } else if (arg === "--graph") {
      args.graph = true;
      i++;
    } else if (arg === "--json") {
      args.json = true;
      i++;
    } else if (arg === "--registry-out") {
      args.registryOut = argv[++i];
      i++;
    } else if (arg === "--validate-registry") {
      args.validateRegistry = true;
      i++;
    } else {
      i++;
    }
  }

  return args;
}

// ── Entry point ────────────────────────────────────────────────────────────

export function executeNavigate(argv: string[]): number {
  const args = parseCliArgs(argv);
  const startTime = Date.now();

  // Scan directory
  const files = scanDirectory(args.dir, args.glob);

  // Parse markers from all files
  const allMarkers: ParsedMarker[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const relPath = relative(process.cwd(), file);
    const markers = parseMarkers(content, relPath);
    allMarkers.push(...markers);
  }

  if (allMarkers.length === 0) {
    process.stderr.write(`[grace-navigate] no markers found in ${args.dir} (ext: ${args.glob})\n`);
    return 0;
  }

  // Build graph
  const graph = buildGraph(allMarkers);
  const registry = buildGraphRegistry(graph, files);

  // Log belief/fact per RUNTIME_LOGGING.md
  const elapsed = Date.now() - startTime;
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      layer: "application",
      mc: "MC-grace-navigate-application-GraceNavigate",
      fc: "FC-grace-navigate-UC-NAVIGATE-buildGraph",
      ba: "BA-NAV-GRAPH-01",
      belief: `Built derived GRACE graph registry with ${registry.summary.nodeCount} nodes, ${registry.summary.edgeCount} edges, and ${registry.summary.issueCount} integrity issues`,
      fact: {
        nodes: registry.summary.nodeCount,
        edges: registry.summary.edgeCount,
        issues: registry.summary.issueCount,
        duplicates: registry.summary.duplicateCount,
        files: files.length,
        elapsedMs: elapsed,
      },
    }),
  );

  if (args.registryOut) {
    const registryPath = writeGraphRegistry(args.registryOut, registry);
    process.stderr.write(`[grace-navigate] graph registry written: ${registryPath}\n`);
  }

  if (args.validateRegistry && registry.issues.length > 0) {
    if (args.json) {
      console.log(JSON.stringify(registry, null, 2));
    } else {
      console.log(`GRAPH_REGISTRY_FAIL issues=${registry.issues.length}`);
      for (const issue of registry.issues) {
        console.log(`[${issue.kind}] ${issue.file} ${issue.nodeId}: ${issue.detail}`);
      }
    }
    return 1;
  }

  // Dispatch mode
  if (args.json) {
    console.log(JSON.stringify(registry, null, 2));
  } else if (args.byAnchor) {
    const result = queryByAnchor(args.byAnchor, graph);
    if (!result) {
      console.error(`[grace-navigate] anchor "${args.byAnchor}" not found`);
      return 1;
    }
    printAnchorResult(result);
  } else if (args.byContract) {
    const result = queryByContract(args.byContract, graph);
    if (!result) {
      console.error(`[grace-navigate] contract "${args.byContract}" not found`);
      return 1;
    }
    printContractResult(result);
  } else if (args.logToken) {
    const semanticId = resolveLogToken(args.logToken);
    if (!semanticId) {
      console.error("[grace-navigate] log token did not contain a GRACE semantic id");
      return 1;
    }
    if (semanticId.startsWith("BA-")) {
      const result = queryByAnchor(semanticId, graph);
      if (!result) {
        console.error(`[grace-navigate] anchor "${semanticId}" not found`);
        return 1;
      }
      printAnchorResult(result);
    } else {
      const result = queryByContract(semanticId, graph);
      if (!result) {
        console.error(`[grace-navigate] contract "${semanticId}" not found`);
        return 1;
      }
      printContractResult(result);
    }
  } else if (args.byUsecase) {
    const results = queryByUsecase(args.byUsecase, graph);
    printUsecaseResult(results);
  } else if (args.graph) {
    console.log(exportMermaid(graph));
  } else {
    printTree(graph);
  }

  return 0;
}

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("grace-navigate.ts") ||
    process.argv[1].endsWith("grace-navigate.js") ||
    process.argv[1].includes("grace-navigate"));

if (isDirect) {
  process.exit(executeNavigate(process.argv.slice(2)));
}
