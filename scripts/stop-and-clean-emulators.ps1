# stop-and-clean-emulators.ps1
# Backward-compatible alias for scripts/reset-emulator-state.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Output "Alias: scripts\\stop-and-clean-emulators.ps1 -> scripts\\reset-emulator-state.ps1"
& powershell -ExecutionPolicy Bypass -File .\scripts\reset-emulator-state.ps1
if ($LASTEXITCODE -ne 0) { throw "reset-emulator-state alias failed with exit code $LASTEXITCODE." }
return
