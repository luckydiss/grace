import { resolve } from "node:path";
import { inferLegacyContracts } from "../legacy/infer-contracts.js";
import { resolveLegacyOverlayTarget } from "../legacy/index.js";

interface CliArgs {
  repoRoot: string;
  productRoot: string;
  sourceRepoRoot: string;
  productId?: string;
  draftsFile?: string;
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
      case "--drafts-file":
        args.draftsFile = argv[++i] ?? args.draftsFile;
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

  const result = inferLegacyContracts({
    target,
    draftsFile: args.draftsFile,
  });

  const payload = {
    ok: true,
    mode: target.mode,
    productId: target.productId,
    productRoot: target.productRoot,
    sourceRepoRoot: target.sourceRepoRoot,
    draftsFile: result.draftsFile,
    summary: result.drafts.summary,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      `GRACE_LEGACY_CONTRACTS_OK product=${target.productId} overlay=${resolve(target.productRoot)} source=${resolve(target.sourceRepoRoot)} drafts=${resolve(result.draftsFile)}`,
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
    console.error(`GRACE_LEGACY_CONTRACTS_ERROR ${message}`);
    process.exit(1);
  });
