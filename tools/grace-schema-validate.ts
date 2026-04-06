#!/usr/bin/env node

import { loadAndValidateJsonFile, type SchemaType } from "./grace-schema.js";

interface CliArgs {
  type?: SchemaType;
  file?: string;
  json: boolean;
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--type") {
      const value = argv[++i];
      if (value === "failure-envelope" || value === "failure-memory" || value === "forced-context-bundle" || value === "loop-guard-verdict" || value === "skill-trace") {
        args.type = value;
      }
    } else if (arg === "--file") {
      args.file = argv[++i];
    } else if (arg === "--json") {
      args.json = true;
    }
  }
  return args;
}

function main(): number {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.type || !args.file) {
    throw new Error("--type and --file are required");
  }

  const value = loadAndValidateJsonFile<Record<string, unknown>>(args.file, args.type);
  const payload = {
    status: "SCHEMA_VALIDATION_PASS",
    type: args.type,
    file: args.file,
    schemaVersion: value.schemaVersion,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`SCHEMA_VALIDATION_PASS type=${args.type} file=${args.file}`);
  }
  return 0;
}

process.exit(main());
