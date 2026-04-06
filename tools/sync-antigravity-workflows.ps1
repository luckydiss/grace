Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$workflowDir = Join-Path $repoRoot ".agent/workflows"

if (-not (Test-Path -Path $workflowDir)) {
    New-Item -ItemType Directory -Path $workflowDir -Force | Out-Null
}

$map = [ordered]@{
    "architect"   = "agents/architect/SYSTEM.md"
    "coordinator" = "agents/coordinator/SYSTEM.md"
    "coder"       = "agents/coder/SYSTEM.md"
}

foreach ($name in $map.Keys) {
    $src = Join-Path $repoRoot $map[$name]
    $dst = Join-Path $workflowDir "$name.md"

    if (-not (Test-Path -Path $src)) {
        throw "Source prompt not found: $src"
    }

    $body = Get-Content -Path $src -Raw -Encoding UTF8
    $out = @"
---
description: GRACE $name (synced from agents)
---

$body
"@
    Set-Content -Path $dst -Value $out -Encoding UTF8
}

Write-Host "Synced: .agent/workflows/{architect,coordinator,coder}.md"
