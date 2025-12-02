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

# Step 1: Start emulator
Write-Host "[1/3] Starting Firebase Functions Emulator..." -ForegroundColor Yellow
$emulatorProcess = Start-Process -FilePath "firebase" -ArgumentList @(
    "emulators:start",
    "--only", "functions",
    "--project", "inverter-automation-firebase"
) -WindowStyle Minimized -PassThru

Write-Host "      Emulator process ID: $($emulatorProcess.Id)" -ForegroundColor Gray

# Step 2: Wait for emulator to be ready
Write-Host "[1/3] Waiting for emulator to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 8

# Step 3: Run tests
Write-Host ""
Write-Host "[2/3] Running end-to-end tests..." -ForegroundColor Yellow
$testResult = & node .\test-emulator.js
$testExitCode = $LASTEXITCODE

Write-Host ""

# Step 4: Report results
if ($testExitCode -eq 0) {
    Write-Host "[3/3] All tests passed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "To stop the emulator, run:" -ForegroundColor Yellow
    Write-Host "  Stop-Process -Id $($emulatorProcess.Id) -Force" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "[3/3] Some tests failed. Check the output above." -ForegroundColor Red
    Write-Host ""
    Write-Host "Stopping emulator..." -ForegroundColor Yellow
    Stop-Process -Id $emulatorProcess.Id -Force -ErrorAction SilentlyContinue
}

exit $testExitCode
