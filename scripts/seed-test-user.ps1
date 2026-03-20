# seed-test-user.ps1
# Seeds and verifies the local emulator test user.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $PSCommandPath
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

$pathBootstrap = Join-Path $scriptDir 'ensure-dev-runtime-path.ps1'
if (Test-Path $pathBootstrap) { . $pathBootstrap }

$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'

Write-Output "Seeding emulator test user (Firestore: $env:FIRESTORE_EMULATOR_HOST, Auth: $env:FIREBASE_AUTH_EMULATOR_HOST)..."

Push-Location functions
node .\scripts\seed-emulator-state.js
$code = $LASTEXITCODE
Pop-Location

if ($code -ne 0) {
    throw "Test-user seed failed (exit $code)."
}

Write-Output "Test-user seed completed successfully."
return
