#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateSkillTraceDocumentValue, type SkillTraceActorRole, type SkillTraceDocument, type SkillTraceSource, type SkillTraceStatus } from "./grace-schema.js";

interface CliArgs {
  file?: string;
  executionId?: string;
  traceId?: string;
  actorRole?: SkillTraceActorRole;
  executionSequence?: number;
  skill?: string;
  status: SkillTraceStatus;
  source?: SkillTraceSource;
  trigger?: string;
  parentSkill?: string;
  invokedAt?: string;
  json: boolean;
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    status: "LOADED",
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--file":
        args.file = argv[++i];
        break;
      case "--execution-id":
        args.executionId = argv[++i];
        break;
      case "--trace-id":
        args.traceId = argv[++i];
        break;
      case "--actor-role": {
        const value = argv[++i];
        if (value === "ARCHITECT" || value === "COORDINATOR" || value === "CODER") {
          args.actorRole = value;
        }
        break;
      }
      case "--execution-sequence":
        args.executionSequence = Number(argv[++i]);
        break;
      case "--skill":
        args.skill = argv[++i];
        break;
      case "--status": {
        const value = argv[++i];
        if (value === "LOADED" || value === "APPLIED") {
          args.status = value;
        }
        break;
      }
      case "--source": {
        const value = argv[++i];
        if (value === "MANDATORY_MODE" || value === "MANDATORY_PROTOCOL" || value === "OPTIONAL" || value === "CHAINED") {
          args.source = value;
        }
        break;
      }
      case "--trigger":
        args.trigger = argv[++i];
        break;
      case "--parent-skill":
        args.parentSkill = argv[++i];
        break;
      case "--invoked-at":
        args.invokedAt = argv[++i];
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

function assertRequiredArgs(args: CliArgs): asserts args is Required<Pick<CliArgs, "file" | "executionId" | "traceId" | "actorRole" | "executionSequence" | "skill" | "source">> & CliArgs {
  if (!args.file || !args.executionId || !args.traceId || !args.actorRole || !args.executionSequence || !args.skill || !args.source) {
    throw new Error("--file, --execution-id, --trace-id, --actor-role, --execution-sequence, --skill, and --source are required");
  }
}

function nextEventId(document: SkillTraceDocument): string {
  const sequence = document.events.length + 1;
  return `${document.executionId}-SKILL-${String(sequence).padStart(2, "0")}`;
}

function loadExisting(filePath: string): SkillTraceDocument | null {
  if (!existsSync(filePath)) {
    return null;
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  return validateSkillTraceDocumentValue(raw);
}

function createDocument(args: Required<Pick<CliArgs, "executionId" | "traceId" | "actorRole" | "executionSequence">>): SkillTraceDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: "grace-skill-trace-v1",
    traceId: args.traceId,
    executionId: args.executionId,
    actorRole: args.actorRole,
    executionSequence: args.executionSequence,
    generatedAt: now,
    events: [],
  };
}

function main(): number {
  const args = parseCliArgs(process.argv.slice(2));
  assertRequiredArgs(args);

  const filePath = resolve(args.file);
  const document = loadExisting(filePath) ?? createDocument(args);

  if (document.executionId !== args.executionId || document.traceId !== args.traceId || document.actorRole !== args.actorRole || document.executionSequence !== args.executionSequence) {
    throw new Error("existing skill trace metadata does not match the requested execution metadata");
  }

  const invokedAt = args.invokedAt ?? new Date().toISOString();
  document.events.push({
    id: nextEventId(document),
    skill: args.skill,
    status: args.status,
    source: args.source,
    invokedAt,
    trigger: args.trigger ?? `skill(name="${args.skill}")`,
    ...(args.parentSkill ? { parentSkill: args.parentSkill } : {}),
  });
  document.generatedAt = invokedAt;

  const validated = validateSkillTraceDocumentValue(document);
  writeFileSync(filePath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");

  const payload = {
    status: "SKILL_TRACE_RECORDED",
    file: args.file,
    executionId: validated.executionId,
    traceId: validated.traceId,
    actorRole: validated.actorRole,
    eventCount: validated.events.length,
    lastSkill: args.skill,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`SKILL_TRACE_RECORDED executionId=${validated.executionId} skill=${args.skill} events=${validated.events.length}`);
  }

  return 0;
}

process.exit(main());
