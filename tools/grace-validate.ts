/*
 * <MODULE_CONTRACT id="MC-grace-validate" version="2.1.0">
 *   <Purpose>
 *     Validate either the GRACE framework repository itself or a GRACE product workspace.
 *     Framework mode checks the presence of core framework assets.
 *     Product mode performs stricter schema and governance checks for canonical GRACE artifacts.
 *   </Purpose>
 *   <Responsibilities>
 *     <Item>Autodetect framework vs product validation when mode is not specified</Item>
 *     <Item>Validate root-level framework asset set for framework-only repositories</Item>
 *     <Item>Validate canonical product artifacts, handoffs, and approvals for GRACE product workspaces</Item>
 *     <Item>Resolve cross-file Link targets and handoff approval references</Item>
 *     <Item>Emit deterministic text or JSON output with non-zero exit code on failure</Item>
 *   </Responsibilities>
 *   <Invariants>
 *     <I1>The validator is read-only.</I1>
 *     <I2>Framework mode never requires demo/product artifacts.</I2>
 *     <I3>Product mode enforces repository-local schema and governance checks without claiming full XSD coverage.</I3>
 *   </Invariants>
 *   <Links>
 *     <Link ref="docs/grace/GRACE_MARKUP_STANDARD.md"/>
 *     <Link ref="docs/grace/RUNTIME_LOGGING.md"/>
 *   </Links>
 * </MODULE_CONTRACT>
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

type ValidationMode = "framework" | "product";

interface CliArgs {
  mode?: ValidationMode;
  root: string;
  json: boolean;
}

interface ValidationIssue {
  code: string;
  file: string;
  detail: string;
}

interface ValidationReport {
  mode: ValidationMode;
  valid: boolean;
  checks: number;
  issues: ValidationIssue[];
}

interface XmlRootExpectation {
  file: string;
  tag: string;
}

interface ParsedApproval {
  ref: string;
  status: string;
  approved: string;
  approver: string;
}

interface ParsedHandoff {
  id: string;
  file: string;
  attributes: Record<string, string>;
  techRefs: string[];
  requirementsRefs: string[];
  planRef?: string;
  blueprintRef?: string;
}

interface ParsedExecutionArtifact {
  file: string;
  rootTag: string;
  attributes: Record<string, string>;
}

interface ParsedCwoArtifact {
  file: string;
  rootTag: string;
  attributes: Record<string, string>;
  handoffRefs: string[];
}

const ISO_8601_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    root: ".",
    json: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--mode") {
      const value = argv[++i];
      if (value === "framework" || value === "product") {
        args.mode = value;
      }
      i++;
    } else if (arg === "--root") {
      args.root = argv[++i] ?? args.root;
      i++;
    } else if (arg === "--json") {
      args.json = true;
      i++;
    } else {
      i++;
    }
  }

  return args;
}

function readUtf8(path: string): string {
  return readFileSync(path, "utf-8");
}

function addIssue(issues: ValidationIssue[], condition: boolean, code: string, file: string, detail: string): void {
  if (!condition) {
    issues.push({ code, file, detail });
  }
}

function detectMode(root: string): ValidationMode {
  const productRequirements = resolve(root, "docs", "grace", "RequirementsAnalysis.xml");
  return existsSync(productRequirements) ? "product" : "framework";
}

function extractAttributes(tagSource: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attrRegex = /([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tagSource)) !== null) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function collectXmlIds(xml: string): Set<string> {
  return new Set(Array.from(xml.matchAll(/\bid="([^"]+)"/g), (match) => match[1]));
}

function collectLinkRefs(xml: string): string[] {
  return Array.from(xml.matchAll(/<Link\s+ref="([^"]+)"/g), (match) => match[1]);
}

function looksLikeXmlDocument(xml: string, rootTag: string): boolean {
  const trimmed = xml.trim();
  return (
    new RegExp(`<${rootTag}(\\s|>)`).test(trimmed) &&
    new RegExp(`</${rootTag}>`).test(trimmed)
  );
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

function resolveRefTarget(root: string, sourceFile: string, refValue: string): { filePath?: string; id?: string } {
  const hashIndex = refValue.indexOf("#");
  if (hashIndex === -1) {
    return { id: refValue };
  }

  const filePart = refValue.slice(0, hashIndex);
  const idPart = refValue.slice(hashIndex + 1);
  const docsGraceRoot = resolve(root, "docs", "grace");
  if (filePart.startsWith("docs/")) {
    return { filePath: resolve(root, filePart), id: idPart };
  }
  if (!filePart.includes("/") && !filePart.includes("\\")) {
    return { filePath: resolve(docsGraceRoot, filePart), id: idPart };
  }
  return { filePath: resolve(dirname(sourceFile), filePart), id: idPart };
}

function validateFramework(root: string): ValidationReport {
  const issues: ValidationIssue[] = [];
  let checks = 0;

  const requiredFiles = [
    "README.md",
    "package.json",
    "docs/grace/GRACE_MARKUP_STANDARD.md",
    "docs/grace/RUNTIME_LOGGING.md",
    "docs/grace/AUTONOMY_FAILURE_ARTIFACTS.md",
    "docs/grace/schema/failure-envelope.schema.json",
    "docs/grace/schema/failure-memory.schema.json",
    "docs/grace/schema/forced-context-bundle.schema.json",
    "docs/grace/schema/loop-guard-verdict.schema.json",
    "docs/grace/templates/README.md",
    "docs/grace/templates/RequirementsAnalysis.xml",
    "docs/grace/templates/Technology.xml",
    "docs/grace/templates/DevelopmentPlan.xml",
    "docs/grace/templates/DevelopmentExecutionPlan.xml",
    "docs/grace/templates/executions/ArchitectExecution.template.xml",
    "docs/grace/templates/executions/CoordinatorExecution.template.xml",
    "docs/grace/templates/executions/CoderExecution.template.xml",
    "docs/grace/templates/executions/AutonomyCycleExecution.template.xml",
    "docs/grace/templates/cwo/README.md",
    "docs/grace/templates/cwo/CoderWorkOrder.template.xml",
    "docs/grace/templates/approvals.log",
    "docs/grace/templates/handoffs/Handoff.template.xml",
    "agents/architect/SYSTEM.md",
    "agents/coder/SYSTEM.md",
    "agents/coordinator/SYSTEM.md",
    "agents/shared/skills/README.md",
    "agents/shared/skills/mode-architect/SKILL.md",
    "agents/shared/skills/mode-coder/SKILL.md",
    "agents/shared/skills/mode-coordinator/SKILL.md",
    "agents/shared/skills/protocol-grace-markup/SKILL.md",
    "agents/shared/skills/protocol-grace-traceability/SKILL.md",
    "agents/shared/skills/protocol-grace-living-document/SKILL.md",
    "agents/shared/skills/protocol-grace-patch-safety/SKILL.md",
    "agents/shared/skills/protocol-grace-runtime-logging/SKILL.md",
    "agents/shared/skills/protocol-grace-retry-budget/SKILL.md",
    "agents/shared/skills/protocol-grace-forced-context/SKILL.md",
    "agents/shared/skills/protocol-grace-failure-memory/SKILL.md",
    "agents/shared/skills/protocol-decision-collapse/SKILL.md",
    "agents/coordinator/skills/coordinator-anti-loop-gate/SKILL.md",
    "agents/coordinator/skills/coordinator-blueprint-gates/SKILL.md",
    "agents/coordinator/skills/coordinator-branchspec-gitflow/SKILL.md",
    "agents/coordinator/skills/coordinator-code-gates/SKILL.md",
    "agents/coordinator/skills/coordinator-living-document-gate/SKILL.md",
    "agents/coordinator/skills/coordinator-traceability-gate/SKILL.md",
    "agents/coordinator/skills/coordinator-work-orders/SKILL.md",
    "tools/grace-init.ts",
    "tools/grace-schema.ts",
    "tools/grace-schema-validate.ts",
    "tools/grace-delivery-trace.ts",
    "tools/grace-validate.ts",
    "tools/grace-execution-schema.ts",
    "tools/grace-execution-proof.ts",
    "tools/grace-navigate.ts",
    "tools/grace-log-trace.ts",
    "tools/grace-patch.ts",
    "tools/grace-sync-contracts.ts",
    "tools/grace-mental-test.ts",
    "tools/grace-fractal.ts",
    "tools/grace-traceability-coverage.ts",
    "tools/grace-failure-memory.ts",
    "tools/grace-inject-context.ts",
    "tools/grace-loop-guard.ts",
    "tools/grace-test-envelope.ts",
    "tools/grace-autonomy-cycle.ts",
  ] as const;

  for (const relPath of requiredFiles) {
    checks++;
    addIssue(
      issues,
      existsSync(resolve(root, relPath)),
      "MISSING_FRAMEWORK_FILE",
      relPath,
      "required framework asset is missing",
    );
  }

  const readmePath = resolve(root, "README.md");
  if (existsSync(readmePath)) {
    checks++;
    const readme = readUtf8(readmePath);
    addIssue(
      issues,
      /framework/i.test(readme) && /examples/i.test(readme) && /skill-first/i.test(readme),
      "README_SCOPE",
      "README.md",
      "README should describe framework-first layout, examples, and skill-first runtime",
    );
  }

  const packagePath = resolve(root, "package.json");
  if (existsSync(packagePath)) {
    checks++;
    const pkg = JSON.parse(readUtf8(packagePath)) as { scripts?: Record<string, string> };
    addIssue(issues, typeof pkg.scripts?.verify === "string", "PACKAGE_VERIFY", "package.json", "missing framework verify script");
    checks++;
    addIssue(issues, typeof pkg.scripts?.["grace:init"] === "string", "PACKAGE_INIT", "package.json", "missing grace:init script");
    checks++;
    addIssue(issues, typeof pkg.scripts?.["execution-proof"] === "string", "PACKAGE_EXECUTION_PROOF", "package.json", "missing execution-proof script");
    checks++;
    addIssue(issues, typeof pkg.scripts?.["execution-schema"] === "string", "PACKAGE_EXECUTION_SCHEMA", "package.json", "missing execution-schema script");
    checks++;
    addIssue(issues, typeof pkg.scripts?.["delivery-trace"] === "string", "PACKAGE_DELIVERY_TRACE", "package.json", "missing delivery-trace script");
    checks++;
    addIssue(issues, typeof pkg.scripts?.["schema-validate"] === "string", "PACKAGE_SCHEMA_VALIDATE", "package.json", "missing schema-validate script");
  }

  const bootstrapExpectations: Array<{ file: string; modeSkill: string; protocolSkills: string[] }> = [
    {
      file: "agents/architect/SYSTEM.md",
      modeSkill: 'skill(name="mode-architect")',
      protocolSkills: [
        'skill(name="protocol-grace-markup")',
        'skill(name="protocol-grace-traceability")',
        'skill(name="protocol-grace-living-document")',
        'skill(name="protocol-decision-collapse")',
      ],
    },
    {
      file: "agents/coder/SYSTEM.md",
      modeSkill: 'skill(name="mode-coder")',
      protocolSkills: [
        'skill(name="protocol-grace-markup")',
        'skill(name="protocol-grace-traceability")',
        'skill(name="protocol-grace-living-document")',
        'skill(name="protocol-grace-patch-safety")',
        'skill(name="protocol-grace-runtime-logging")',
        'skill(name="protocol-grace-retry-budget")',
        'skill(name="protocol-grace-forced-context")',
        'skill(name="protocol-grace-failure-memory")',
      ],
    },
    {
      file: "agents/coordinator/SYSTEM.md",
      modeSkill: 'skill(name="mode-coordinator")',
      protocolSkills: [
        'skill(name="protocol-grace-markup")',
        'skill(name="protocol-grace-traceability")',
        'skill(name="protocol-grace-living-document")',
        'skill(name="protocol-grace-patch-safety")',
        'skill(name="protocol-grace-retry-budget")',
        'skill(name="protocol-grace-forced-context")',
        'skill(name="protocol-grace-failure-memory")',
      ],
    },
  ];

  for (const expectation of bootstrapExpectations) {
    const fullPath = resolve(root, expectation.file);
    if (!existsSync(fullPath)) {
      continue;
    }
    const content = readUtf8(fullPath);
    checks++;
    addIssue(
      issues,
      /MANDATORY MODE/.test(content),
      "BOOTSTRAP_MODE_SECTION",
      expectation.file,
      "bootstrap prompt must declare a MANDATORY MODE section",
    );
    checks++;
    addIssue(
      issues,
      /MANDATORY PROTOCOL/.test(content),
      "BOOTSTRAP_PROTOCOL_SECTION",
      expectation.file,
      "bootstrap prompt must declare a MANDATORY PROTOCOL section",
    );
    checks++;
    addIssue(
      issues,
      content.includes(expectation.modeSkill),
      "BOOTSTRAP_MODE_SKILL",
      expectation.file,
      `bootstrap prompt must load ${expectation.modeSkill}`,
    );
    for (const protocolSkill of expectation.protocolSkills) {
      checks++;
      addIssue(
        issues,
        content.includes(protocolSkill),
        "BOOTSTRAP_PROTOCOL_SKILL",
        expectation.file,
        `bootstrap prompt must load ${protocolSkill}`,
      );
    }
  }

  return {
    mode: "framework",
    valid: issues.length === 0,
    checks,
    issues,
  };
}

function validateXmlRoots(
  root: string,
  issues: ValidationIssue[],
  expectations: XmlRootExpectation[],
): { checks: number; idsByFile: Map<string, Set<string>>; linksByFile: Map<string, string[]> } {
  let checks = 0;
  const idsByFile = new Map<string, Set<string>>();
  const linksByFile = new Map<string, string[]>();

  for (const expectation of expectations) {
    const fullPath = resolve(root, expectation.file);
    if (!existsSync(fullPath)) {
      continue;
    }

    const xml = readUtf8(fullPath);
    idsByFile.set(fullPath, collectXmlIds(xml));
    linksByFile.set(fullPath, collectLinkRefs(xml));

    checks++;
    addIssue(
      issues,
      looksLikeXmlDocument(xml, expectation.tag),
      "INVALID_PRODUCT_ROOT",
      expectation.file,
      `expected root tag <${expectation.tag}>`,
    );

    checks++;
    addIssue(
      issues,
      /^\s*<\?xml\b/.test(xml),
      "MISSING_XML_DECLARATION",
      expectation.file,
      "expected XML declaration at file start",
    );
  }

  return { checks, idsByFile, linksByFile };
}

function parseApprovals(approvalsPath: string, issues: ValidationIssue[]): { checks: number; approvals: ParsedApproval[] } {
  let checks = 0;
  const approvals: ParsedApproval[] = [];
  if (!existsSync(approvalsPath)) {
    return { checks, approvals };
  }

  const content = readUtf8(approvalsPath);
  const blocks = Array.from(content.matchAll(/<GRACE_APPROVAL\b([\s\S]*?)\/>/g));

  for (const block of blocks) {
    const attrs = extractAttributes(block[1]);
    const approval: ParsedApproval = {
      ref: attrs.ref ?? "",
      status: attrs.status ?? "",
      approved: attrs.approved ?? "",
      approver: attrs.approver ?? "",
    };
    approvals.push(approval);

    checks++;
    addIssue(issues, approval.ref.length > 0, "APPROVAL_REF", "docs/grace/approvals.log", "approval is missing ref attribute");
    checks++;
    addIssue(issues, approval.status === "APPROVED", "APPROVAL_STATUS", "docs/grace/approvals.log", "approval status must be APPROVED");
    checks++;
    addIssue(issues, ISO_8601_WITH_OFFSET.test(approval.approved), "APPROVAL_DATETIME", "docs/grace/approvals.log", "approval datetime must use ISO-8601 with offset");
    checks++;
    addIssue(issues, approval.approver.length > 0, "APPROVAL_APPROVER", "docs/grace/approvals.log", "approval is missing approver");
  }

  return { checks, approvals };
}

function parseHandoffs(root: string, issues: ValidationIssue[]): { checks: number; handoffs: ParsedHandoff[]; idsByFile: Map<string, Set<string>>; linksByFile: Map<string, string[]> } {
  let checks = 0;
  const handoffs: ParsedHandoff[] = [];
  const idsByFile = new Map<string, Set<string>>();
  const linksByFile = new Map<string, string[]>();
  const handoffDir = resolve(root, "docs", "grace", "handoffs");

  for (const handoffPath of listXmlFiles(handoffDir)) {
    const filename = handoffPath.split(/[/\\]/).pop() ?? "";
    if (!/^Handoff-.*\.xml$/.test(filename)) {
      continue;
    }
    const relPath = handoffPath.replace(`${root}\\`, "").replace(/\\/g, "/");
    const xml = readUtf8(handoffPath);
    idsByFile.set(handoffPath, collectXmlIds(xml));
    linksByFile.set(handoffPath, collectLinkRefs(xml));

    const headerMatch = xml.match(/<GRACE_HANDOFF\b([\s\S]*?)>/);
    checks++;
    addIssue(issues, headerMatch !== null, "HANDOFF_ROOT", relPath, "expected GRACE_HANDOFF root element");
    if (headerMatch === null) {
      continue;
    }

    const attrs = extractAttributes(headerMatch[1]);
    const handoff: ParsedHandoff = {
      id: attrs.id ?? "",
      file: handoffPath,
      attributes: attrs,
      techRefs: (attrs.techRef ?? "").split(",").map((item) => item.trim()).filter(Boolean),
      requirementsRefs: (attrs.requirementsRef ?? "").split(",").map((item) => item.trim()).filter(Boolean),
      planRef: attrs.planRef,
      blueprintRef: attrs.blueprintRef,
    };
    handoffs.push(handoff);

    checks++;
    addIssue(issues, handoff.id.length > 0, "HANDOFF_ID", relPath, "handoff is missing id attribute");
    checks++;
    addIssue(issues, attrs.schemaVersion === "grace-markup-v2", "HANDOFF_SCHEMA", relPath, "handoff must declare schemaVersion=\"grace-markup-v2\"");
    checks++;
    addIssue(issues, ISO_8601_WITH_OFFSET.test(attrs.created ?? ""), "HANDOFF_CREATED", relPath, "handoff created must use ISO-8601 with offset");
    checks++;
    addIssue(issues, (attrs.status ?? "").length > 0, "HANDOFF_STATUS", relPath, "handoff is missing status attribute");
    checks++;
    addIssue(issues, (attrs.author ?? "").length > 0, "HANDOFF_AUTHOR", relPath, "handoff is missing author attribute");
    checks++;
    addIssue(issues, (attrs.taskRef ?? "").length > 0, "HANDOFF_TASKREF", relPath, "handoff is missing taskRef attribute");
    checks++;
    addIssue(issues, (attrs.planRef ?? "").length > 0, "HANDOFF_PLANREF", relPath, "handoff is missing planRef attribute");
    checks++;
    addIssue(issues, (attrs.blueprintRef ?? "").length > 0, "HANDOFF_BLUEPRINTREF", relPath, "handoff is missing blueprintRef attribute");
    checks++;
    addIssue(issues, !/<GRACE_APPROVAL\b/.test(xml), "HANDOFF_EMBEDDED_APPROVAL", relPath, "handoff must not embed GRACE_APPROVAL tags");
  }

  return { checks, handoffs, idsByFile, linksByFile };
}

function parseExecutionArtifacts(root: string, issues: ValidationIssue[]): { checks: number; artifacts: ParsedExecutionArtifact[] } {
  let checks = 0;
  const artifacts: ParsedExecutionArtifact[] = [];
  const executionDir = resolve(root, "docs", "grace", "executions");
  if (!existsSync(executionDir)) {
    return { checks, artifacts };
  }

  for (const executionPath of listXmlFiles(executionDir)) {
    const relPath = executionPath.replace(`${root}\\`, "").replace(/\\/g, "/");
    const xml = readUtf8(executionPath);
    const headerMatch = xml.match(/<([A-Za-z]+Execution)\b([\s\S]*?)>/);
    checks++;
    addIssue(issues, headerMatch !== null, "EXECUTION_ROOT", relPath, "expected execution root element");
    if (headerMatch === null) {
      continue;
    }
    const rootTag = headerMatch[1];
    const attrs = extractAttributes(headerMatch[2]);
    artifacts.push({ file: executionPath, rootTag, attributes: attrs });

    checks++;
    addIssue(issues, (attrs.id ?? "").length > 0, "EXECUTION_ID", relPath, "execution artifact is missing id attribute");
    checks++;
    addIssue(issues, (attrs.traceId ?? "").length > 0, "EXECUTION_TRACE_ID", relPath, "execution artifact is missing traceId attribute");
    checks++;
    addIssue(issues, (attrs.actorRole ?? "").length > 0, "EXECUTION_ACTOR_ROLE", relPath, "execution artifact is missing actorRole attribute");
    checks++;
    addIssue(issues, (attrs.sequence ?? "").length > 0, "EXECUTION_SEQUENCE", relPath, "execution artifact is missing sequence attribute");
    checks++;
    addIssue(issues, /<InputRefs>[\s\S]*?<Ref\s+value="/.test(xml), "EXECUTION_INPUT_REFS", relPath, "execution artifact must contain InputRefs with at least one Ref");
    checks++;
    addIssue(issues, /<OutputRefs>[\s\S]*?<Ref\s+value="/.test(xml), "EXECUTION_OUTPUT_REFS", relPath, "execution artifact must contain OutputRefs with at least one Ref");
    checks++;
    addIssue(issues, /<RequiredSkillRefs>[\s\S]*?<Skill\s+name="/.test(xml), "EXECUTION_SKILLS", relPath, "execution artifact must contain RequiredSkillRefs with at least one Skill");
  }

  return { checks, artifacts };
}

function parseCwoArtifacts(root: string, issues: ValidationIssue[]): { checks: number; artifacts: ParsedCwoArtifact[] } {
  let checks = 0;
  const artifacts: ParsedCwoArtifact[] = [];
  const cwoDir = resolve(root, "docs", "grace", "cwo");
  if (!existsSync(cwoDir)) {
    return { checks, artifacts };
  }

  for (const cwoPath of listXmlFiles(cwoDir)) {
    const filename = cwoPath.split(/[/\\]/).pop() ?? "";
    if (!/^CWO-.*\.xml$/.test(filename)) {
      continue;
    }
    const relPath = cwoPath.replace(`${root}\\`, "").replace(/\\/g, "/");
    const xml = readUtf8(cwoPath);
    const headerMatch = xml.match(/<(CODER_WORK_ORDER|ARCHITECT_WORK_ORDER)\b([\s\S]*?)>/);
    checks++;
    addIssue(issues, headerMatch !== null, "CWO_ROOT", relPath, "expected work-order root element");
    if (headerMatch === null) {
      continue;
    }

    const attrs = extractAttributes(headerMatch[2]);
    const handoffRefs = Array.from(xml.matchAll(/<HandoffRef>([^<]+)<\/HandoffRef>/g), (match) => match[1].trim()).filter(Boolean);
    artifacts.push({
      file: cwoPath,
      rootTag: headerMatch[1],
      attributes: attrs,
      handoffRefs,
    });

    checks++;
    addIssue(issues, (attrs.id ?? "").length > 0, "CWO_ID", relPath, "work order is missing id attribute");
    checks++;
    addIssue(issues, (attrs.status ?? "").length > 0, "CWO_STATUS", relPath, "work order is missing status attribute");
    checks++;
    addIssue(issues, handoffRefs.length > 0, "CWO_HANDOFF_REF", relPath, "work order must contain at least one HandoffRef");
  }

  return { checks, artifacts };
}

function buildGlobalIdIndex(...maps: Array<Map<string, Set<string>>>): Set<string> {
  const ids = new Set<string>();
  for (const map of maps) {
    for (const idSet of map.values()) {
      for (const id of idSet) {
        ids.add(id);
      }
    }
  }
  return ids;
}

function validateRefs(
  root: string,
  issues: ValidationIssue[],
  linksByFile: Map<string, string[]>,
  idsByFile: Map<string, Set<string>>,
  globalIds: Set<string>,
): number {
  let checks = 0;
  for (const [sourceFile, refs] of linksByFile.entries()) {
    const relSource = sourceFile.replace(`${root}\\`, "").replace(/\\/g, "/");
    for (const ref of refs) {
      const target = resolveRefTarget(root, sourceFile, ref);
      if (target.filePath) {
        checks++;
        addIssue(issues, existsSync(target.filePath), "LINK_TARGET_FILE", relSource, `link target file does not exist: ${ref}`);
        if (!existsSync(target.filePath) || !target.id) {
          continue;
        }
        const targetIds = idsByFile.get(target.filePath) ?? collectXmlIds(readUtf8(target.filePath));
        checks++;
        addIssue(issues, targetIds.has(target.id), "LINK_TARGET_ID", relSource, `link target id does not exist: ${ref}`);
      } else if (target.id) {
        checks++;
        addIssue(issues, globalIds.has(target.id), "LINK_TARGET_ID", relSource, `link target id does not exist: ${ref}`);
      }
    }
  }
  return checks;
}

function validateProduct(root: string): ValidationReport {
  const issues: ValidationIssue[] = [];
  let checks = 0;

  const requiredFiles = [
    "docs/grace/RequirementsAnalysis.xml",
    "docs/grace/Technology.xml",
    "docs/grace/DevelopmentPlan.xml",
    "docs/grace/DevelopmentExecutionPlan.xml",
    "docs/grace/approvals.log",
  ] as const;

  for (const relPath of requiredFiles) {
    checks++;
    addIssue(
      issues,
      existsSync(resolve(root, relPath)),
      "MISSING_PRODUCT_FILE",
      relPath,
      "required canonical product artifact is missing",
    );
  }

  const xmlExpectations: XmlRootExpectation[] = [
    { file: "docs/grace/RequirementsAnalysis.xml", tag: "RequirementsAnalysis" },
    { file: "docs/grace/Technology.xml", tag: "Technology" },
    { file: "docs/grace/DevelopmentPlan.xml", tag: "DevelopmentPlan" },
    { file: "docs/grace/DevelopmentExecutionPlan.xml", tag: "DevelopmentExecutionPlan" },
  ];

  const canonical = validateXmlRoots(root, issues, xmlExpectations);
  checks += canonical.checks;

  const handoffData = parseHandoffs(root, issues);
  checks += handoffData.checks;
  const cwoData = parseCwoArtifacts(root, issues);
  checks += cwoData.checks;
  const executionData = parseExecutionArtifacts(root, issues);
  checks += executionData.checks;

  const approvalsPath = resolve(root, "docs", "grace", "approvals.log");
  const approvalData = parseApprovals(approvalsPath, issues);
  checks += approvalData.checks;

  const globalIds = buildGlobalIdIndex(canonical.idsByFile, handoffData.idsByFile);
  const allLinksByFile = new Map<string, string[]>([
    ...canonical.linksByFile.entries(),
    ...handoffData.linksByFile.entries(),
  ]);
  const allIdsByFile = new Map<string, Set<string>>([
    ...canonical.idsByFile.entries(),
    ...handoffData.idsByFile.entries(),
  ]);
  checks += validateRefs(root, issues, allLinksByFile, allIdsByFile, globalIds);

  const handoffIds = new Set(handoffData.handoffs.map((handoff) => handoff.id));
  const handoffsById = new Map(handoffData.handoffs.map((handoff) => [handoff.id, handoff] as const));
  for (const approval of approvalData.approvals) {
    checks++;
    addIssue(
      issues,
      handoffIds.size === 0 || handoffIds.has(approval.ref),
      "APPROVAL_HANDOFF_REF",
      "docs/grace/approvals.log",
      `approval ref does not match any handoff id: ${approval.ref}`,
    );
  }

  for (const handoff of handoffData.handoffs) {
    const relPath = handoff.file.replace(`${root}\\`, "").replace(/\\/g, "/");
    for (const ref of [handoff.planRef, handoff.blueprintRef, ...handoff.techRefs, ...handoff.requirementsRefs]) {
      if (!ref) {
        continue;
      }
      const target = resolveRefTarget(root, handoff.file, ref);
      if (target.filePath) {
        checks++;
        addIssue(issues, existsSync(target.filePath), "HANDOFF_REF_FILE", relPath, `handoff reference target file does not exist: ${ref}`);
        if (existsSync(target.filePath) && target.id) {
          const targetIds = allIdsByFile.get(target.filePath) ?? collectXmlIds(readUtf8(target.filePath));
          checks++;
          addIssue(issues, targetIds.has(target.id), "HANDOFF_REF_ID", relPath, `handoff reference target id does not exist: ${ref}`);
        }
      }
    }
  }

  for (const cwo of cwoData.artifacts) {
    const relPath = cwo.file.replace(`${root}\\`, "").replace(/\\/g, "/");
    for (const handoffRef of cwo.handoffRefs) {
      const handoff = handoffsById.get(handoffRef);
      checks++;
      addIssue(
        issues,
        handoff !== undefined,
        "CWO_HANDOFF_TARGET",
        relPath,
        `work order handoff ref does not match any handoff id: ${handoffRef}`,
      );
      if (handoff !== undefined) {
        if ((handoff.attributes.traceId ?? "").length > 0) {
          checks++;
          addIssue(
            issues,
            (cwo.attributes.traceId ?? "").length > 0,
            "CWO_TRACE_ID",
            relPath,
            "trace-aware work order must declare traceId attribute when linked handoff is trace-aware",
          );
          checks++;
          addIssue(
            issues,
            handoff.attributes.traceId === cwo.attributes.traceId,
            "CWO_TRACE_CHAIN",
            relPath,
            `work order traceId should match referenced handoff traceId: ${handoffRef}`,
          );
        }
      }
    }
  }

  if (executionData.artifacts.length > 0 && handoffData.handoffs.length > 0) {
    const handoffTraceIds = Array.from(new Set(handoffData.handoffs.map((handoff) => handoff.attributes.traceId).filter((value): value is string => typeof value === "string" && value.length > 0)));
    const cwoTraceIds = Array.from(new Set(cwoData.artifacts.map((artifact) => artifact.attributes.traceId).filter((value): value is string => typeof value === "string" && value.length > 0)));
    checks++;
    addIssue(
      issues,
      handoffTraceIds.length > 0,
      "TRACE_AWARE_HANDOFF_REQUIRED",
      "docs/grace/handoffs",
      "at least one trace-aware handoff is required when execution artifacts are present",
    );
    checks++;
    addIssue(
      issues,
      cwoTraceIds.length > 0,
      "TRACE_AWARE_CWO_REQUIRED",
      "docs/grace/cwo",
      "at least one trace-aware work order is required when execution artifacts are present",
    );
    for (const artifact of executionData.artifacts) {
      const relPath = artifact.file.replace(`${root}\\`, "").replace(/\\/g, "/");
      checks++;
      addIssue(
        issues,
        handoffTraceIds.includes(artifact.attributes.traceId ?? ""),
        "EXECUTION_TRACE_CHAIN",
        relPath,
        "execution traceId should match one of the declared handoff trace ids",
      );
      if (artifact.attributes.actorRole === "COORDINATOR" || artifact.attributes.actorRole === "CODER") {
        checks++;
        addIssue(
          issues,
          cwoTraceIds.includes(artifact.attributes.traceId ?? ""),
          "EXECUTION_CWO_TRACE_CHAIN",
          relPath,
          "coder/coordinator execution traceId should match one of the declared work-order trace ids",
        );
      }
    }
  }

  return {
    mode: "product",
    valid: issues.length === 0,
    checks,
    issues,
  };
}

function formatReport(report: ValidationReport, jsonMode: boolean): string {
  if (jsonMode) {
    return JSON.stringify(report, null, 2);
  }

  if (report.valid) {
    return `VALIDATION_PASS mode=${report.mode} checks=${report.checks}`;
  }

  const lines = [`VALIDATION_FAIL mode=${report.mode}`, ""];
  for (const issue of report.issues) {
    lines.push(`[${issue.code}] ${issue.file}: ${issue.detail}`);
  }
  lines.push("");
  lines.push(`Checks: ${report.checks}`);
  lines.push(`Issues: ${report.issues.length}`);
  return lines.join("\n");
}

/*
 * <FUNCTION_CONTRACT id="FC-grace-validate-executeValidation">
 *   <Intent>
 *     Execute framework or product validation and emit a deterministic report.
 *   </Intent>
 *   <Inputs>
 *     <Input name="argv">Raw CLI arguments.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="exitCode">0 when validation passes, otherwise 1.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-W8-VALIDATE-STRICT-PARSE"/>
 *     <BA ref="BA-W8-VALIDATE-STRICT-RESOLVE-LINKS"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
function executeValidation(argv: string[]): number {
  const args = parseCliArgs(argv);
  const root = resolve(process.cwd(), args.root);

  /* <BLOCK_ANCHOR id="BA-W8-VALIDATE-STRICT-PARSE" purpose="Parse CLI mode and collect schema or governance inputs for validation" /> */
  const mode = args.mode ?? detectMode(root);
  const report = mode === "framework" ? validateFramework(root) : validateProduct(root);

  /* <BLOCK_ANCHOR id="BA-W8-VALIDATE-STRICT-RESOLVE-LINKS" purpose="Resolve cross-file references and emit the final deterministic validation report" /> */
  console.log(formatReport(report, args.json));
  return report.valid ? 0 : 1;
}

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("grace-validate.ts") ||
    process.argv[1].endsWith("grace-validate.js") ||
    process.argv[1].includes("grace-validate"));

if (isDirect) {
  process.exit(executeValidation(process.argv.slice(2)));
}

export { executeValidation };
