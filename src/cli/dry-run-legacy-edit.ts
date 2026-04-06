import { resolve } from "node:path";
import { proposeLegacyDryRunEdit, resolveLegacyOverlayTarget } from "../legacy/index.js";
import { createCliArgCursor } from "./args.js";

interface CliArgs {
  repoRoot: string;
  productRoot: string;
  sourceRepoRoot?: string;
  productId?: string;
  traceId?: string;
  sliceId: string;
  requestedWritePaths: string[];
  writeModeAuthorized: boolean;
  planFile?: string;
  policyFile?: string;
  dryRunFile?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    repoRoot: process.cwd(),
    productRoot: process.cwd(),
    sliceId: "",
    requestedWritePaths: [],
    writeModeAuthorized: false,
    json: false,
  };

  const cursor = createCliArgCursor(argv);
  while (cursor.hasMore()) {
    const arg = cursor.current();
    switch (arg) {
      case "--repo-root":
        args.repoRoot = cursor.next(args.repoRoot) ?? args.repoRoot;
        break;
      case "--product-root":
        args.productRoot = cursor.next(args.productRoot) ?? args.productRoot;
        break;
      case "--source-repo-root":
        args.sourceRepoRoot = cursor.next(args.sourceRepoRoot) ?? args.sourceRepoRoot;
        break;
      case "--product-id":
        args.productId = cursor.next(args.productId) ?? args.productId;
        break;
      case "--trace-id":
        args.traceId = cursor.next(args.traceId) ?? args.traceId;
        break;
      case "--slice-id":
        args.sliceId = cursor.next(args.sliceId) ?? args.sliceId;
        break;
      case "--requested-write-path":
        args.requestedWritePaths.push(cursor.next("") ?? "");
        break;
      case "--write-mode-authorized":
        args.writeModeAuthorized = true;
        break;
      case "--plan-file":
        args.planFile = cursor.next(args.planFile) ?? args.planFile;
        break;
      case "--policy-file":
        args.policyFile = cursor.next(args.policyFile) ?? args.policyFile;
        break;
      case "--dry-run-file":
        args.dryRunFile = cursor.next(args.dryRunFile) ?? args.dryRunFile;
        break;
      case "--json":
        args.json = true;
        break;
      default:
        break;
    }
    cursor.advance();
  }

  return args;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sliceId) {
    throw new Error("--slice-id is required");
  }
  if (args.requestedWritePaths.length === 0) {
    throw new Error("at least one --requested-write-path is required");
  }

  const target = resolveLegacyOverlayTarget({
    repoRoot: args.repoRoot,
    productRoot: args.productRoot,
    sourceRepoRoot: args.sourceRepoRoot ?? args.productRoot,
    productId: args.productId,
    traceId: args.traceId,
  });
  const result = proposeLegacyDryRunEdit({
    target,
    planFile: args.planFile ? resolve(args.planFile) : undefined,
    policyFile: args.policyFile ? resolve(args.policyFile) : undefined,
    dryRunFile: args.dryRunFile ? resolve(args.dryRunFile) : undefined,
    sliceId: args.sliceId,
    requestedWritePaths: args.requestedWritePaths,
    writeModeAuthorized: args.writeModeAuthorized,
  });
  const payload = {
    dryRunFile: result.dryRunFile,
    ok: result.dryRun.ok,
    failureCount: result.dryRun.failures.length,
    sliceId: result.dryRun.sliceId,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`GRACE_LEGACY_DRY_RUN ok=${payload.ok} failures=${payload.failureCount} file=${payload.dryRunFile}`);
  }
  return 0;
}

void Promise.resolve()
  .then(() => main())
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`GRACE_LEGACY_DRY_RUN_ERROR ${message}`);
    process.exit(1);
  });
