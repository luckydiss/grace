import { resolve } from "node:path";
import { resolveLegacyOverlayTarget } from "../legacy/index.js";
import { seedLegacyTraceability } from "../legacy/trace-seed.js";
import { createCliArgCursor } from "./args.js";

interface CliArgs {
  repoRoot: string;
  productRoot: string;
  sourceRepoRoot: string;
  productId?: string;
  registryFile?: string;
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
      case "--registry-file":
        args.registryFile = cursor.next(args.registryFile) ?? args.registryFile;
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

  const result = seedLegacyTraceability({
    target,
    registryFile: args.registryFile,
  });

  const payload = {
    ok: true,
    mode: target.mode,
    productId: target.productId,
    productRoot: target.productRoot,
    sourceRepoRoot: target.sourceRepoRoot,
    registryFile: result.registryFile,
    summary: result.registry.summary,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      `GRACE_LEGACY_TRACE_OK product=${target.productId} overlay=${resolve(target.productRoot)} source=${resolve(target.sourceRepoRoot)} registry=${resolve(result.registryFile)}`,
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
    console.error(`GRACE_LEGACY_TRACE_ERROR ${message}`);
    process.exit(1);
  });
