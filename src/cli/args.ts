export interface CliArgCursor {
  hasMore(): boolean;
  current(): string;
  next(defaultValue?: string): string | undefined;
  advance(): void;
}

export function createCliArgCursor(argv: string[]): CliArgCursor {
  let index = 0;
  return {
    hasMore(): boolean {
      return index < argv.length;
    },
    current(): string {
      return argv[index] ?? "";
    },
    next(defaultValue?: string): string | undefined {
      index += 1;
      return argv[index] ?? defaultValue;
    },
    advance(): void {
      index += 1;
    },
  };
}
