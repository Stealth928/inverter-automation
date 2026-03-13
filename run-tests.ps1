#!/usr/bin/env pwsh
# Comprehensive test runner for inverter automation system
# Usage:
#   .\run-tests.ps1                # Run backend + frontend tests
#   .\run-tests.ps1 -Type backend  # Run all backend tests
#   .\run-tests.ps1 -Type frontend # Run Playwright UI tests
#   .\run-tests.ps1 -Type unit     # Alias for backend tests
#   .\run-tests.ps1 -Type auth     # Run auth flow tests (emulator required)
#   .\run-tests.ps1 -Type backend -Coverage  # Backend with coverage

param(
    [Parameter()]
    [ValidateSet('all', 'backend', 'frontend', 'unit', 'auth')]
    [string]$Type = 'all',

    [Parameter()]
    [switch]$Coverage
)

$ErrorActionPreference = 'Stop'
$testsFailed = $false

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host " INVERTER AUTOMATION TEST SUITE" -ForegroundColor Cyan
Write-Host "============================================================`n" -ForegroundColor Cyan

try {
    # Frontend tests
    if ($Type -eq 'all' -or $Type -eq 'frontend') {
        Write-Host "Running Frontend UI Tests (Playwright)..." -ForegroundColor Yellow
        Write-Host "------------------------------------------------------------" -ForegroundColor Gray

        Push-Location $PSScriptRoot
        npx playwright test
        Pop-Location

        if ($LASTEXITCODE -ne 0) {
            Write-Host "`nFrontend tests FAILED" -ForegroundColor Red
            $testsFailed = $true
        } else {
            Write-Host "`nFrontend tests PASSED" -ForegroundColor Green
        }

        Write-Host ""
    }

    Push-Location "$PSScriptRoot\functions"

    # Backend / Unit tests
    if ($Type -eq 'all' -or $Type -eq 'backend' -or $Type -eq 'unit') {
        Write-Host "Running Backend Jest Tests..." -ForegroundColor Yellow
        Write-Host "------------------------------------------------------------" -ForegroundColor Gray

        if ($Coverage) {
            npm test -- --coverage
        } else {
            npm test
        }

        if ($LASTEXITCODE -ne 0) {
            Write-Host "`nBackend tests FAILED" -ForegroundColor Red
            $testsFailed = $true
        } else {
            Write-Host "`nBackend tests PASSED" -ForegroundColor Green
        }

        Write-Host ""
    }

    # Auth flow tests
    if ($Type -eq 'auth') {
        Write-Host "Running Authentication Flow Tests..." -ForegroundColor Yellow
        Write-Host "------------------------------------------------------------" -ForegroundColor Gray
        Write-Host "   Requires emulators. Start with: npm run emu:start" -ForegroundColor Gray
        Write-Host ""

        npm test -- test/auth-flows.test.js

        if ($LASTEXITCODE -ne 0) {
            Write-Host "`nAuth flow tests FAILED" -ForegroundColor Red
            $testsFailed = $true
        } else {
            Write-Host "`nAuth flow tests PASSED" -ForegroundColor Green
        }

        Write-Host ""
    }

    Write-Host "============================================================" -ForegroundColor Cyan
    if ($testsFailed) {
        Write-Host " TESTS FAILED - See errors above" -ForegroundColor Red
        Write-Host "============================================================`n" -ForegroundColor Cyan
        exit 1
    } else {
        Write-Host " ALL TESTS PASSED" -ForegroundColor Green
        Write-Host "============================================================`n" -ForegroundColor Cyan
        exit 0
    }
}
finally {
    Pop-Location
}
