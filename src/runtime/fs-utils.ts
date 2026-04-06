import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function readTextIfExists(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function readJsonIfExists<T>(filePath: string): T | null {
  const text = readTextIfExists(filePath);
  return text === null ? null : (JSON.parse(text) as T);
}
