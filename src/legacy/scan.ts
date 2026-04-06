import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { ensureParentDir } from "../runtime/fs-utils.js";
import type { ProductTargetConfig } from "../runtime/product-target.js";

export interface LegacyScanEntry {
  ref: string;
  kind: "file" | "directory";
  language?: string;
  role?: "entrypoint" | "test" | "config" | "dependency-surface" | "source" | "other";
}

export interface LegacyScanSummary {
  totalFiles: number;
  totalDirectories: number;
  byLanguage: Record<string, number>;
  entrypointCount: number;
  testCount: number;
  configCount: number;
  dependencySurfaceCount: number;
}

export interface LegacyScanReport {
  schemaVersion: "grace-legacy-scan-report-v1";
  productId: string;
  traceId: string;
  sourceRepoRoot: string;
  generatedAt: string;
  topology: LegacyScanEntry[];
  entrypoints: string[];
  tests: string[];
  configs: string[];
  dependencySurfaces: string[];
  summary: LegacyScanSummary;
}

export interface LegacyRiskFinding {
  code:
    | "LARGE_FILE"
    | "LARGE_DIRECTORY"
    | "NO_TESTS_DETECTED"
    | "NO_ENTRYPOINTS_DETECTED"
    | "NO_DEPENDENCY_SURFACES_DETECTED"
    | "SKIPPED_GENERATED_OR_VENDOR_PATH";
  severity: "info" | "warn";
  ref: string;
  details: string;
}

export interface LegacyRiskSummary {
  findingCount: number;
  byCode: Record<string, number>;
  highestSeverity: "info" | "warn" | "none";
}

export interface LegacyRiskReport {
  schemaVersion: "grace-legacy-risk-report-v1";
  productId: string;
  traceId: string;
  sourceRepoRoot: string;
  generatedAt: string;
  findings: LegacyRiskFinding[];
  summary: LegacyRiskSummary;
}

export interface ScanLegacyRepositoryInput {
  target: ProductTargetConfig;
  reportFile?: string;
  riskReportFile?: string;
}

export interface ScanLegacyRepositoryResult {
  reportFile: string;
  report: LegacyScanReport;
  riskReportFile: string;
  riskReport: LegacyRiskReport;
}

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".idea",
  ".vscode",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  "__pycache__",
  ".venv",
  "venv",
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".go": "go",
  ".java": "java",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".kt": "kotlin",
  ".mjs": "javascript",
  ".mts": "typescript",
  ".php": "php",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".sh": "shell",
  ".sql": "sql",
  ".swift": "swift",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
};

const DEPENDENCY_SURFACE_NAMES = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "requirements.txt",
  "requirements-dev.txt",
  "pyproject.toml",
  "poetry.lock",
  "Pipfile",
  "Pipfile.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "composer.json",
  "composer.lock",
  ".csproj",
  ".sln",
];

const CONFIG_NAMES = [
  "tsconfig.json",
  "tsconfig.base.json",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.js",
  ".prettierrc",
  ".prettierrc.json",
  ".editorconfig",
  "jest.config.js",
  "jest.config.ts",
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "webpack.config.ts",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
];

const GENERATED_OR_VENDOR_DIRECTORY_HINTS = ["generated", "__generated__", "vendor", "third_party"];
const LARGE_FILE_LINE_THRESHOLD = 300;
const LARGE_DIRECTORY_FILE_THRESHOLD = 25;

function toRef(root: string, candidate: string): string {
  return relative(root, candidate).replaceAll("\\", "/") || ".";
}

function inferLanguage(filePath: string): string | undefined {
  const extension = extname(filePath).toLowerCase();
  if (extension in LANGUAGE_BY_EXTENSION) {
    return LANGUAGE_BY_EXTENSION[extension];
  }

  if (filePath.endsWith(".csproj")) {
    return "xml";
  }

  return undefined;
}

function isDependencySurface(fileName: string): boolean {
  return DEPENDENCY_SURFACE_NAMES.includes(fileName) || fileName.endsWith(".csproj") || fileName.endsWith(".sln");
}

function isConfigFile(fileName: string): boolean {
  return CONFIG_NAMES.includes(fileName);
}

function isEntrypoint(fileName: string, fileRef: string): boolean {
  const lowerName = fileName.toLowerCase();
  if (
    lowerName === "main.ts" ||
    lowerName === "main.js" ||
    lowerName === "index.ts" ||
    lowerName === "index.js" ||
    lowerName === "app.ts" ||
    lowerName === "app.js" ||
    lowerName === "server.ts" ||
    lowerName === "server.js" ||
    lowerName === "__main__.py"
  ) {
    return true;
  }

  return /(^|\/)(src|cmd|app|server|cli)\//u.test(fileRef) && /(main|index|app|server|cli)\./u.test(lowerName);
}

function isTestFile(fileName: string, fileRef: string): boolean {
  const lowerName = fileName.toLowerCase();
  return (
    /\.test\./u.test(lowerName) ||
    /\.spec\./u.test(lowerName) ||
    lowerName.startsWith("test_") ||
    lowerName.endsWith("_test.py") ||
    /(^|\/)(test|tests|__tests__|spec)\//u.test(fileRef.toLowerCase())
  );
}

function inferRole(fileName: string, fileRef: string): LegacyScanEntry["role"] {
  if (isDependencySurface(fileName)) {
    return "dependency-surface";
  }
  if (isConfigFile(fileName)) {
    return "config";
  }
  if (isTestFile(fileName, fileRef)) {
    return "test";
  }
  if (isEntrypoint(fileName, fileRef)) {
    return "entrypoint";
  }
  if (/\.(ts|tsx|js|jsx|py|java|cs|go|rb|php|rs|kt|swift)$/u.test(fileName.toLowerCase())) {
    return "source";
  }
  return "other";
}

function walkDirectory(root: string, current: string, topology: LegacyScanEntry[]): void {
  const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    const ref = toRef(root, absolutePath);

    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      topology.push({
        ref,
        kind: "directory",
      });
      walkDirectory(root, absolutePath, topology);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    topology.push({
      ref,
      kind: "file",
      language: inferLanguage(absolutePath),
      role: inferRole(entry.name, ref),
    });
  }
}

function buildLegacyScanReport(target: ProductTargetConfig): LegacyScanReport {
  const topology: LegacyScanEntry[] = [];
  walkDirectory(target.sourceRepoRoot, target.sourceRepoRoot, topology);

  const entrypoints = topology
    .filter((entry) => entry.kind === "file" && entry.role === "entrypoint")
    .map((entry) => entry.ref);
  const tests = topology.filter((entry) => entry.kind === "file" && entry.role === "test").map((entry) => entry.ref);
  const configs = topology
    .filter((entry) => entry.kind === "file" && entry.role === "config")
    .map((entry) => entry.ref);
  const dependencySurfaces = topology
    .filter((entry) => entry.kind === "file" && entry.role === "dependency-surface")
    .map((entry) => entry.ref);

  const byLanguage: Record<string, number> = {};
  for (const entry of topology) {
    if (entry.kind === "file" && entry.language) {
      byLanguage[entry.language] = (byLanguage[entry.language] ?? 0) + 1;
    }
  }

  return {
    schemaVersion: "grace-legacy-scan-report-v1",
    productId: target.productId,
    traceId: target.traceId,
    sourceRepoRoot: target.sourceRepoRoot,
    generatedAt: new Date().toISOString(),
    topology,
    entrypoints,
    tests,
    configs,
    dependencySurfaces,
    summary: {
      totalFiles: topology.filter((entry) => entry.kind === "file").length,
      totalDirectories: topology.filter((entry) => entry.kind === "directory").length,
      byLanguage,
      entrypointCount: entrypoints.length,
      testCount: tests.length,
      configCount: configs.length,
      dependencySurfaceCount: dependencySurfaces.length,
    },
  };
}

function countFileLines(filePath: string): number {
  return readFileSync(filePath, "utf8").split(/\r?\n/u).length;
}

function buildLegacyRiskReport(target: ProductTargetConfig, report: LegacyScanReport): LegacyRiskReport {
  const findings: LegacyRiskFinding[] = [];
  const byCode: Record<string, number> = {};
  const directoryFileCounts = new Map<string, number>();

  const files = report.topology.filter((entry) => entry.kind === "file");

  for (const file of files) {
    const directoryRef = file.ref.includes("/") ? file.ref.slice(0, file.ref.lastIndexOf("/")) : ".";
    directoryFileCounts.set(directoryRef, (directoryFileCounts.get(directoryRef) ?? 0) + 1);

    if (GENERATED_OR_VENDOR_DIRECTORY_HINTS.some((hint) => file.ref.toLowerCase().includes(`/${hint}/`))) {
      findings.push({
        code: "SKIPPED_GENERATED_OR_VENDOR_PATH",
        severity: "info",
        ref: file.ref,
        details: "Path suggests generated or vendor-owned code that should be treated carefully during onboarding.",
      });
    }

    const absolutePath = resolve(target.sourceRepoRoot, file.ref);
    const lineCount = countFileLines(absolutePath);
    if (lineCount > LARGE_FILE_LINE_THRESHOLD) {
      findings.push({
        code: "LARGE_FILE",
        severity: "warn",
        ref: file.ref,
        details: `File has ${lineCount} lines which exceeds the large-file threshold of ${LARGE_FILE_LINE_THRESHOLD}.`,
      });
    }
  }

  for (const [directoryRef, fileCount] of directoryFileCounts.entries()) {
    if (fileCount > LARGE_DIRECTORY_FILE_THRESHOLD) {
      findings.push({
        code: "LARGE_DIRECTORY",
        severity: "warn",
        ref: directoryRef,
        details: `Directory contains ${fileCount} files which exceeds the large-directory threshold of ${LARGE_DIRECTORY_FILE_THRESHOLD}.`,
      });
    }
  }

  if (report.tests.length === 0) {
    findings.push({
      code: "NO_TESTS_DETECTED",
      severity: "warn",
      ref: ".",
      details: "No tests were discovered in the legacy repository scan.",
    });
  }

  if (report.entrypoints.length === 0) {
    findings.push({
      code: "NO_ENTRYPOINTS_DETECTED",
      severity: "info",
      ref: ".",
      details: "No obvious entrypoint files were discovered during the legacy repository scan.",
    });
  }

  if (report.dependencySurfaces.length === 0) {
    findings.push({
      code: "NO_DEPENDENCY_SURFACES_DETECTED",
      severity: "info",
      ref: ".",
      details: "No dependency surface files were discovered during the legacy repository scan.",
    });
  }

  for (const finding of findings) {
    byCode[finding.code] = (byCode[finding.code] ?? 0) + 1;
  }

  const highestSeverity = findings.some((finding) => finding.severity === "warn")
    ? "warn"
    : findings.some((finding) => finding.severity === "info")
      ? "info"
      : "none";

  return {
    schemaVersion: "grace-legacy-risk-report-v1",
    productId: target.productId,
    traceId: target.traceId,
    sourceRepoRoot: target.sourceRepoRoot,
    generatedAt: new Date().toISOString(),
    findings,
    summary: {
      findingCount: findings.length,
      byCode,
      highestSeverity,
    },
  };
}

export function scanLegacyRepository(input: ScanLegacyRepositoryInput): ScanLegacyRepositoryResult {
  const reportFile =
    input.reportFile ?? resolve(input.target.productRoot, "docs", "grace", "reports", "LegacyScanReport.json");
  const riskReportFile =
    input.riskReportFile ?? resolve(input.target.productRoot, "docs", "grace", "reports", "LegacyRiskReport.json");

  const sourceRepoStatusBefore = statSync(input.target.sourceRepoRoot).mtimeMs;
  const report = buildLegacyScanReport(input.target);
  const riskReport = buildLegacyRiskReport(input.target, report);

  ensureParentDir(reportFile);
  ensureParentDir(riskReportFile);
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(riskReportFile, `${JSON.stringify(riskReport, null, 2)}\n`, "utf8");

  const sourceRepoStatusAfter = statSync(input.target.sourceRepoRoot).mtimeMs;
  if (sourceRepoStatusAfter !== sourceRepoStatusBefore) {
    throw new Error("legacy scan must not mutate the source repository");
  }

  return {
    reportFile,
    report,
    riskReportFile,
    riskReport,
  };
}

export function readLegacyScanReport(reportFile: string): LegacyScanReport {
  return JSON.parse(readFileSync(reportFile, "utf8")) as LegacyScanReport;
}

export function readLegacyRiskReport(reportFile: string): LegacyRiskReport {
  return JSON.parse(readFileSync(reportFile, "utf8")) as LegacyRiskReport;
}
