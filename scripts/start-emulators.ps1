param(
    [switch]$SkipSeed
)

# start-emulators.ps1
# Starts configured emulators in the background and (by default) seeds a test user.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $PSCommandPath
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

$pathBootstrap = Join-Path $scriptDir 'ensure-dev-runtime-path.ps1'
if (Test-Path $pathBootstrap) { . $pathBootstrap }

$logDir = 'logs'
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$stdout = Join-Path $logDir 'emulator.out.log'
$stderr = Join-Path $logDir 'emulator.err.log'

$emulatorList = 'functions,firestore,hosting,auth,pubsub'

$uiConn = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
if ($uiConn) {
    Write-Output "Emulators already appear to be running on port 4000. Skipping start."
    if (-not $SkipSeed) {
        & powershell -ExecutionPolicy Bypass -File .\scripts\seed-test-user.ps1
        if ($LASTEXITCODE -ne 0) { throw "Test-user seed failed with exit code $LASTEXITCODE." }
    }
    return
}

Write-Output "Starting emulators in background..."
Write-Output "Emulators: $emulatorList"
Write-Output "Logs: $stdout"

# Use cmd /c so npx path resolution works correctly on Windows.
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx firebase emulators:start --only $emulatorList --import=./emulator-state --export-on-exit > $stdout 2> $stderr" -PassThru -WindowStyle Hidden

if (-not $proc) {
    Write-Output "Failed to start emulator process."
    throw "Failed to start emulator process."
}

$proc.Id | Out-File -FilePath 'emulator.pid' -Encoding ascii
Write-Output "Emulators started with PID $($proc.Id)"
Write-Output "Waiting for emulators to be ready..."

# Wait up to 30 seconds for UI port.
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $conn = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $ready = $true
        break
    }
}

if (-not $ready) {
    Write-Output "Emulators taking a long time to start. Check $stdout for progress."
    throw "Emulators did not become ready in time."
}

Write-Output "Emulators are READY at http://127.0.0.1:4000"

if (-not $SkipSeed) {
    Write-Output "Ensuring local test user exists..."
    & powershell -ExecutionPolicy Bypass -File .\scripts\seed-test-user.ps1
    if ($LASTEXITCODE -ne 0) { throw "Test-user seed failed with exit code $LASTEXITCODE." }
}
return
