import { resolve } from "node:path";
import { resolveLegacyOverlayTarget } from "../legacy/index.js";
import { proposeLegacySlice } from "../legacy/slice-propose.js";

interface CliArgs {
  repoRoot: string;
  productRoot: string;
  sourceRepoRoot: string;
  productId?: string;
  planFile?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    repoRoot: process.cwd(),
    productRoot: process.cwd(),
    sourceRepoRoot: process.cwd(),
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--repo-root":
        args.repoRoot = argv[++i] ?? args.repoRoot;
        break;
      case "--product-root":
        args.productRoot = argv[++i] ?? args.productRoot;
        break;
      case "--source-repo-root":
        args.sourceRepoRoot = argv[++i] ?? args.sourceRepoRoot;
        break;
      case "--product-id":
        args.productId = argv[++i] ?? args.productId;
        break;
      case "--plan-file":
        args.planFile = argv[++i] ?? args.planFile;
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

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveLegacyOverlayTarget({
    repoRoot: args.repoRoot,
    productRoot: args.productRoot,
    sourceRepoRoot: args.sourceRepoRoot,
    productId: args.productId,
  });

  const result = proposeLegacySlice({
    target,
    planFile: args.planFile,
  });

  const payload = {
    ok: true,
    mode: target.mode,
    productId: target.productId,
    productRoot: target.productRoot,
    sourceRepoRoot: target.sourceRepoRoot,
    planFile: result.planFile,
    summary: result.plan.summary,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      `GRACE_LEGACY_SLICES_OK product=${target.productId} overlay=${resolve(target.productRoot)} source=${resolve(target.sourceRepoRoot)} plan=${resolve(result.planFile)}`,
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
    console.error(`GRACE_LEGACY_SLICES_ERROR ${message}`);
    process.exit(1);
  });
