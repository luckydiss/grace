/*
 * <MODULE_CONTRACT id="MC-grace-init" version="1.0.0">
 *   <Purpose>
 *     Bootstrap a new GRACE product workspace from the framework templates.
 *   </Purpose>
 *   <Responsibilities>
 *     <Item>Copy canonical XML and approvals templates into a target workspace</Item>
 *     <Item>Create baseline docs/grace and src directories</Item>
 *     <Item>Replace template placeholders for product id and product name</Item>
 *     <Item>Preserve trace-aware bootstrap templates for handoffs and executions</Item>
 *   </Responsibilities>
 *   <Links>
 *     <Link ref="docs/grace/templates/README.md"/>
 *   </Links>
 * </MODULE_CONTRACT>
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

interface CliArgs {
  out: string;
  productId: string;
  productName: string;
  runtime: "grace";
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    out: "products/new-product",
    productId: "my-product",
    productName: "My Product",
    runtime: "grace",
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--out") {
      args.out = argv[++i] ?? args.out;
      i++;
    } else if (arg === "--product-id") {
      args.productId = argv[++i] ?? args.productId;
      i++;
    } else if (arg === "--product-name") {
      args.productName = argv[++i] ?? args.productName;
      i++;
    } else if (arg === "--runtime") {
      const runtime = argv[++i];
      if (runtime !== "grace") {
        throw new Error(`Unsupported runtime '${runtime ?? ""}'. GRACE now bootstraps products in grace-only mode.`);
      }
      args.runtime = "grace";
      i++;
    } else {
      i++;
    }
  }

  return args;
}

function copyTemplateTree(sourceDir: string, targetDir: string, replacements: Array<[string, string]>): void {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir)) {
    const srcPath = join(sourceDir, entry);
    const destPath = join(targetDir, entry);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      copyTemplateTree(srcPath, destPath, replacements);
      continue;
    }
    let content = readFileSync(srcPath, "utf-8");
    for (const [needle, value] of replacements) {
      content = content.replaceAll(needle, value);
    }
    writeFileSync(destPath, content, "utf-8");
  }
}

function buildGracePolicyTemplate(productId: string, artifactBaseRef: string): string {
  const traceId = `TRACE-${productId.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-CORE`;
  const docRef = (suffix: string) => `${artifactBaseRef}/docs/grace/${suffix}`;
  return `${JSON.stringify(
    {
      schemaVersion: "grace-transition-policy-v1",
      productId,
      traceId,
      transitions: {
        classify_intake: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        block_intake: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        start_blueprint: {
          allowedActors: ["ARCHITECT", "COORDINATOR"],
          requiredArtifactRefs: [docRef("RequirementsAnalysis.xml"), docRef("Technology.xml")],
        },
        submit_blueprint_for_review: {
          allowedActors: ["ARCHITECT"],
          requiredArtifactRefs: [docRef("DevelopmentPlan.xml"), docRef("DevelopmentExecutionPlan.xml")],
        },
        approve_blueprint: {
          allowedActors: ["COORDINATOR", "HUMAN"],
          requiredArtifactRefs: [docRef("DevelopmentPlan.xml")],
        },
        reject_blueprint: {
          allowedActors: ["COORDINATOR", "HUMAN"],
          requiredArtifactRefs: [docRef("DevelopmentPlan.xml")],
        },
        start_handoff: {
          allowedActors: ["COORDINATOR", "ARCHITECT"],
          requiredArtifactRefs: [docRef("handoffs/")],
        },
        propose_handoff: {
          allowedActors: ["COORDINATOR", "ARCHITECT"],
          requiredArtifactRefs: [docRef("handoffs/")],
        },
        request_handoff_approval: {
          allowedActors: ["COORDINATOR", "ARCHITECT"],
          requiredArtifactRefs: [docRef("handoffs/")],
        },
        approve_handoff: {
          allowedActors: ["HUMAN"],
          requiredArtifactRefs: [docRef("handoffs/")],
        },
        reject_handoff: {
          allowedActors: ["HUMAN", "COORDINATOR"],
          requiredArtifactRefs: [docRef("handoffs/")],
        },
        draft_cwo: {
          allowedActors: ["COORDINATOR"],
          requiredArtifactRefs: [docRef("handoffs/")],
        },
        issue_branchspec: {
          allowedActors: ["COORDINATOR"],
          requiredArtifactRefs: [docRef("cwo/")],
        },
        issue_cwo: {
          allowedActors: ["COORDINATOR"],
          requiredArtifactRefs: [docRef("approvals.log"), docRef("cwo/")],
        },
        reject_cwo: {
          allowedActors: ["COORDINATOR"],
          requiredArtifactRefs: [docRef("cwo/")],
        },
        activate_coder: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("cwo/")],
        },
        pause_coder: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("cwo/")],
        },
        submit_coder_output: {
          allowedActors: ["CODER"],
          requiredArtifactRefs: [],
        },
        reject_coder_output: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("cwo/")],
        },
        split_scope_and_reissue_cwo: {
          allowedActors: ["COORDINATOR"],
          requiredArtifactRefs: [docRef("cwo/")],
        },
        start_verification: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        record_verification_pass: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        record_verification_fail: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        record_traceability_pass: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        record_traceability_fail: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        record_living_doc_fail: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/living-doc-report.json")],
        },
        capture_failure: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        append_failure_memory: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/failure-memory.json")],
        },
        inject_forced_context: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/failure-memory.json"), docRef("reports/forced-context.json")],
        },
        evaluate_loop_guard: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/loop-guard.json")],
        },
        allow_remediation: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/loop-guard.json")],
        },
        block_remediation: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/loop-guard.json")],
        },
        mark_ready_for_release: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        mark_delivered: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        archive_delivery: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        block_workflow: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        escalate_to_human: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        cancel_workflow: {
          allowedActors: ["HUMAN", "COORDINATOR"],
          requiredArtifactRefs: [],
        },
      },
    },
    null,
    2,
  )}\n`;
}

function buildGraceWorkflowState(productId: string): string {
  return `${JSON.stringify(
    {
      schemaVersion: "grace-workflow-state-v1",
      productId,
      traceId: `TRACE-${productId.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-CORE`,
      currentState: "INTAKE_RECEIVED",
      governance: {
        blocked: false,
        blockReasons: [],
      },
      approval: {
        required: true,
        present: false,
      },
      history: [],
    },
    null,
    2,
  )}\n`;
}

function buildGracePackageJson(productId: string): string {
  return `${JSON.stringify(
    {
      name: `${productId}-grace-product`,
      version: "0.1.0",
      private: true,
      type: "module",
      engines: {
        node: ">=20",
      },
      scripts: {
        build: "node ../node_modules/typescript/bin/tsc -p tsconfig.json",
        test: "node --test dist/**/*.test.js",
      },
    },
    null,
    2,
  )}\n`;
}

function buildGraceTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        rootDir: "src",
        outDir: "dist",
        strict: true,
        noEmitOnError: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    },
    null,
    2,
  )}\n`;
}

function buildGraceSourceReadme(): string {
  return [
    "# Source Surface",
    "",
    "This workspace was bootstrapped in `grace-native` mode.",
    "",
    "Recommended first slices:",
    "- `FC-<product>-state-applyTransition` equivalent workflow adapter or product state entrypoint",
    "- bounded verification/report surfaces",
    "- workflow-owned artifact emitters",
    "",
    "Keep delivery semantic-slice-first: one `FC` per coder chunk.",
  ].join("\n");
}

function writeGraceScaffold(productRoot: string, productId: string, productName: string, frameworkRoot: string): void {
  const docsGraceRoot = resolve(productRoot, "docs", "grace");
  const artifactBaseRef = relative(frameworkRoot, productRoot).replaceAll("\\", "/");
  mkdirSync(resolve(docsGraceRoot, "state"), { recursive: true });
  mkdirSync(resolve(docsGraceRoot, "policies"), { recursive: true });
  mkdirSync(resolve(docsGraceRoot, "reports"), { recursive: true });
  mkdirSync(resolve(docsGraceRoot, "executions"), { recursive: true });

  writeFileSync(resolve(docsGraceRoot, "state", "WorkflowState.json"), buildGraceWorkflowState(productId), "utf-8");
  writeFileSync(resolve(docsGraceRoot, "state", "TransitionLog.jsonl"), "", "utf-8");
  writeFileSync(resolve(docsGraceRoot, "policies", "transition-policy.json"), buildGracePolicyTemplate(productId, artifactBaseRef), "utf-8");
  writeFileSync(resolve(productRoot, "package.json"), buildGracePackageJson(productId), "utf-8");
  writeFileSync(resolve(productRoot, "tsconfig.json"), buildGraceTsconfig(), "utf-8");
  writeFileSync(resolve(productRoot, "src", "README.md"), buildGraceSourceReadme(), "utf-8");

  const readmePath = resolve(productRoot, "README.md");
  writeFileSync(
    readmePath,
    [
      `# ${productName}`,
      "",
      "Bootstrapped from the GRACE framework in `grace-native` mode.",
      "",
      `- Product id: \`${productId}\``,
      `- Framework source: \`${relative(productRoot, process.cwd()) || "."}\``,
      "- Legacy GRACE artifacts remain present for compatibility, but new work should route through workflow state, policy, and bounded execution.",
      "",
      "Recommended next steps:",
      "1. fill in `docs/grace/RequirementsAnalysis.xml`",
      "2. fill in `docs/grace/Technology.xml`",
      "3. fill in `docs/grace/DevelopmentPlan.xml`",
      "4. fill in `docs/grace/DevelopmentExecutionPlan.xml`",
      "5. use `docs/grace/state/WorkflowState.json` and `docs/grace/policies/transition-policy.json` as the GRACE process-control baseline",
    ].join("\n"),
    "utf-8",
  );
}

/*
 * <FUNCTION_CONTRACT id="FC-grace-init-executeInit">
 *   <Intent>
 *     Create a new GRACE product workspace from the framework templates.
 *   </Intent>
 * </FUNCTION_CONTRACT>
 */
function executeInit(argv: string[]): number {
  const args = parseCliArgs(argv);
  const frameworkRoot = process.cwd();
  const templatesDir = resolve(frameworkRoot, "docs", "grace", "templates");
  const outRoot = resolve(frameworkRoot, args.out);
  const productRoot = resolve(outRoot, args.productId);

  mkdirSync(productRoot, { recursive: true });
  mkdirSync(resolve(productRoot, "src"), { recursive: true });

  copyTemplateTree(
    templatesDir,
    resolve(productRoot, "docs", "grace"),
    [
      ["__PRODUCT_ID__", args.productId],
      ["__PRODUCT_NAME__", args.productName],
    ],
  );

  writeGraceScaffold(productRoot, args.productId, args.productName, frameworkRoot);

  console.log(`GRACE_INIT_OK ${relative(frameworkRoot, productRoot)} runtime=${args.runtime}`);
  return 0;
}

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("grace-init.ts") ||
    process.argv[1].endsWith("grace-init.js") ||
    process.argv[1].includes("grace-init"));

if (isDirect) {
  process.exit(executeInit(process.argv.slice(2)));
}

export { executeInit };
