export interface GraceRuntimeLogEntry {
  mc: string;
  fc: string;
  ba: string;
  belief: string;
  fact: Record<string, unknown>;
}

export function emitGraceRuntimeLog(entry: GraceRuntimeLogEntry): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      layer: "runtime",
      ...entry,
    }),
  );
}

export function createGraceRuntimeLogger(context: Pick<GraceRuntimeLogEntry, "mc" | "fc">) {
  return (entry: Omit<GraceRuntimeLogEntry, "mc" | "fc">): void => {
    emitGraceRuntimeLog({
      ...context,
      ...entry,
    });
  };
}
