# Verify all require("common.*") paths resolve to existing Lua modules.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$fail = 0
$pattern = 'require\("common\.[^"]+"\)'

function Resolve-Module($modPath) {
    $fsPath = $modPath -replace '\.', '\'
    if (Test-Path "$fsPath.lua") { return $true }
    if (Test-Path "$fsPath\init.lua") { return $true }
    return $false
}

Write-Host "=== require path checks ==="

Get-ChildItem -Recurse -Filter *.lua | ForEach-Object {
    Select-String -Path $_.FullName -Pattern $pattern -AllMatches | ForEach-Object {
        $_.Matches | ForEach-Object { $_.Value }
    }
} | Sort-Object -Unique | ForEach-Object {
    $mod = $_ -replace '^require\("', '' -replace '"\)$', ''
    if (Resolve-Module $mod) {
        Write-Host "OK: $mod"
    } else {
        Write-Host "FAIL: missing module for $_"
        $fail = 1
    }
}

if ($fail -ne 0) {
    Write-Host ""
    Write-Host "Verification FAILED"
    exit 1
}

Write-Host ""
Write-Host "Verification PASSED"
