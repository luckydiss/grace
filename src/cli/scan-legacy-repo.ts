import { resolve } from "node:path";
import { resolveLegacyOverlayTarget } from "../legacy/index.js";
import { scanLegacyRepository } from "../legacy/scan.js";
import { createCliArgCursor } from "./args.js";

interface CliArgs {
  repoRoot: string;
  productRoot: string;
  sourceRepoRoot: string;
  productId?: string;
  reportFile?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    repoRoot: process.cwd(),
    productRoot: process.cwd(),
    sourceRepoRoot: process.cwd(),
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
      case "--report-file":
        args.reportFile = cursor.next(args.reportFile) ?? args.reportFile;
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

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveLegacyOverlayTarget({
    repoRoot: args.repoRoot,
    productRoot: args.productRoot,
    sourceRepoRoot: args.sourceRepoRoot,
    productId: args.productId,
  });

  const result = scanLegacyRepository({
    target,
    reportFile: args.reportFile,
  });

  const payload = {
    ok: true,
    mode: target.mode,
    productId: target.productId,
    productRoot: target.productRoot,
    sourceRepoRoot: target.sourceRepoRoot,
    reportFile: result.reportFile,
    summary: result.report.summary,
    riskReportFile: result.riskReportFile,
    riskSummary: result.riskReport.summary,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      `GRACE_LEGACY_SCAN_OK product=${target.productId} overlay=${resolve(target.productRoot)} source=${resolve(target.sourceRepoRoot)} report=${resolve(result.reportFile)}`,
    );
  }

  return 0;
}

void main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`GRACE_LEGACY_SCAN_ERROR ${message}`);
    process.exit(1);
  });
