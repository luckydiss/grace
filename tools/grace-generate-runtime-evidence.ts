/*
 * <MODULE_CONTRACT id="MC-grace-generate-runtime-evidence" version="1.0.0">
 *   <Purpose>
 *     Generate a deterministic runtime evidence log for a compiled product slice by executing the
 *     target server module and capturing its structured GRACE runtime logs.
 *   </Purpose>
 *   <Responsibilities>
 *     <Item>Start the compiled target server on an ephemeral port</Item>
 *     <Item>Exercise the routed paths needed to cover the active BA inventory</Item>
 *     <Item>Capture JSON-line runtime logs emitted to stderr</Item>
 *     <Item>Write the captured lines to an evidence file for later traceability checks</Item>
 *   </Responsibilities>
 *   <Invariants>
 *     <I1>The generator depends on a compiled server module path that exports createAppServer and listen.</I1>
 *     <I2>The generated evidence file is deterministic for the same route set and code.</I2>
 *     <I3>The server is always closed before the process exits.</I3>
 *   </Invariants>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W7-T2"/>
 *     <Link ref="DevelopmentPlan.xml#DP-SVC-grace-traceability-coverage"/>
 *   </Links>
 * </MODULE_CONTRACT>
 */

import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface CliArgs {
  out: string;
  serverModule: string;
}

interface ExerciseRequest {
  method: string;
  path: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    out: "docs/grace/reports/runtime-evidence.jsonl",
    serverModule: "dist/server.js",
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--out") {
      args.out = argv[++i] ?? args.out;
      i++;
    } else if (arg === "--server-module") {
      args.serverModule = argv[++i] ?? args.serverModule;
      i++;
    } else {
      i++;
    }
  }

  return args;
}

function httpRequest(method: string, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = http.request(url, { method }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk;
      });
      res.on("end", () => {
        resolvePromise({ status: res.statusCode ?? 0, body: data });
      });
    });
    req.on("error", rejectPromise);
    req.end();
  });
}

/*
 * <FUNCTION_CONTRACT id="FC-grace-generate-runtime-evidence-execute">
 *   <Intent>
 *     Execute the runtime evidence capture flow and write a JSONL artifact.
 *   </Intent>
 *   <Inputs>
 *     <Input name="argv">Raw CLI arguments.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="exitCode">0 on success, 1 on failure.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-RTE-BOOT"/>
 *     <BA ref="BA-RTE-EXERCISE"/>
 *     <BA ref="BA-RTE-WRITE"/>
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */
async function executeGenerateRuntimeEvidence(argv: string[]): Promise<number> {
  const args = parseCliArgs(argv);
  const outPath = resolve(process.cwd(), args.out);
  const serverModuleUrl = pathToFileURL(resolve(process.cwd(), args.serverModule)).href;

  /* <BLOCK_ANCHOR id="BA-RTE-BOOT" purpose="Load compiled server module and start the server on an ephemeral port" /> */
  const serverModule = await import(serverModuleUrl) as {
    createAppServer: () => http.Server;
    listen: (server: http.Server, host: string, port: number) => Promise<void>;
    graceExercisePlan?: ExerciseRequest[];
  };
  const server = serverModule.createAppServer();

  const capturedLines: string[] = [];
  const originalError = console.error;
  console.error = (...argsToLog: unknown[]) => {
    const line = argsToLog.map((item) => String(item)).join(" ");
    if (line.trim().startsWith("{")) {
      capturedLines.push(line);
    }
    originalError(...argsToLog);
  };

  try {
    await serverModule.listen(server, "127.0.0.1", 0);
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected AddressInfo from runtime evidence server");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    /* <BLOCK_ANCHOR id="BA-RTE-EXERCISE" purpose="Exercise the route set required for BA coverage" /> */
    const exercisePlan = serverModule.graceExercisePlan ?? [
      { method: "GET", path: "/" },
      { method: "GET", path: "/health" },
      { method: "GET", path: "/version" },
      { method: "POST", path: "/" },
      { method: "GET", path: "/unknown" },
    ];
    for (const request of exercisePlan) {
      await httpRequest(request.method, `${baseUrl}${request.path}`);
    }
  } finally {
    console.error = originalError;
    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.close((err) => (err ? rejectPromise(err) : resolvePromise()));
    });
  }

  /* <BLOCK_ANCHOR id="BA-RTE-WRITE" purpose="Persist captured runtime logs as a JSONL artifact" /> */
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${capturedLines.join("\n")}\n`, "utf-8");
  console.log(`RUNTIME_EVIDENCE_WRITTEN ${args.out} (${capturedLines.length} lines)`);
  return 0;
}

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("grace-generate-runtime-evidence.ts") ||
    process.argv[1].endsWith("grace-generate-runtime-evidence.js") ||
    process.argv[1].includes("grace-generate-runtime-evidence"));

if (isDirect) {
  executeGenerateRuntimeEvidence(process.argv.slice(2)).then(
    (exitCode) => process.exit(exitCode),
    (err) => {
      process.stderr.write(`[grace-generate-runtime-evidence] FATAL: ${String(err)}\n`);
      process.exit(1);
    },
  );
}

export { executeGenerateRuntimeEvidence };
