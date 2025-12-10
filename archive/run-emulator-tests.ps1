#!/usr/bin/env pwsh
<#
.SYNOPSIS
Test script for Firebase Functions Emulator

.DESCRIPTION
This script starts the Firebase Functions emulator and runs end-to-end tests

.EXAMPLE
.\run-emulator-tests.ps1
#>

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Firebase Functions Emulator Test Suite" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Change to project root directory
$scriptDir = Split-Path -Parent $PSCommandPath
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

# Step 1: Start emulator as a background job
Write-Host "[1/3] Starting Firebase Functions Emulator..." -ForegroundColor Yellow
$emulatorJob = Start-Job -ScriptBlock {
    Set-Location $using:projectRoot
    firebase emulators:start --only functions --project inverter-automation-firebase
}

Write-Host "      Emulator job ID: $($emulatorJob.Id)" -ForegroundColor Gray

# Step 2: Wait for emulator to be ready by polling the endpoint
Write-Host "[1/3] Waiting for emulator to be ready..." -ForegroundColor Yellow
$maxAttempts = 30
$attempt = 0
$ready = $false

while ($attempt -lt $maxAttempts -and -not $ready) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:5001/" -TimeoutSec 2 -ErrorAction SilentlyContinue
        $ready = $true
        Write-Host "      Emulator is ready!" -ForegroundColor Green
    } catch {
        $attempt++
        Start-Sleep -Seconds 1
        Write-Host "." -NoNewline -ForegroundColor Gray
    }
}

if (-not $ready) {
    Write-Host ""
    Write-Host "ERROR: Emulator failed to start within 30 seconds" -ForegroundColor Red
    Stop-Job -Job $emulatorJob
    Remove-Job -Job $emulatorJob
    exit 1
}
Write-Host ""

# Step 3: Run tests
Write-Host ""
Write-Host "[2/3] Running end-to-end tests..." -ForegroundColor Yellow
$testResult = & node .\functions\e2e-tests.js
$testExitCode = $LASTEXITCODE

Write-Host ""

# Step 4: Report results and cleanup
Write-Host ""
Write-Host "Stopping emulator..." -ForegroundColor Yellow
Stop-Job -Job $emulatorJob -ErrorAction SilentlyContinue
Remove-Job -Job $emulatorJob -Force -ErrorAction SilentlyContinue

if ($testExitCode -eq 0) {
    Write-Host "[3/3] All tests passed!" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "[3/3] Some tests failed. Check the output above." -ForegroundColor Red
    Write-Host ""
}

exit $testExitCode
