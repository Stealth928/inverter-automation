# seed-auth-user.ps1
# Backward-compatible alias for scripts/seed-test-user.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Output "Alias: scripts\\seed-auth-user.ps1 -> scripts\\seed-test-user.ps1"
& powershell -ExecutionPolicy Bypass -File .\scripts\seed-test-user.ps1
if ($LASTEXITCODE -ne 0) { throw "seed-test-user alias failed with exit code $LASTEXITCODE." }
return
