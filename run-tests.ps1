#!/usr/bin/env pwsh
# Comprehensive test runner for inverter automation system
# Usage:
#   .\run-tests.ps1              # Run all tests
#   .\run-tests.ps1 -Type unit   # Run only unit tests
#   .\run-tests.ps1 -Type unit -Coverage   # Run unit tests with coverage
#   .\run-tests.ps1 -Type e2e -Prod -AuthToken "your-token-here"  # E2E with auth
#   .\run-tests.ps1 -Type integration -Prod  # Run integration tests against prod
#
# HOW TO GET AUTH TOKEN:
#   1. Open app in browser and login
#   2. Open DevTools Console
#   3. Run: firebase.auth().currentUser.getIdToken().then(t => console.log(t))
#   4. Copy the token and use with -AuthToken parameter

param(
    [Parameter()]
    [ValidateSet('all', 'unit', 'integration', 'e2e', 'auth')]
    [string]$Type = 'all',
    
    [Parameter()]
    [switch]$Coverage,
    
    [Parameter()]
    [switch]$Prod,
    
    [Parameter()]
    [string]$AuthToken = $null,
    
    [Parameter()]
    [switch]$SkipAuth
)

$ErrorActionPreference = 'Stop'
$testsFailed = $false

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host " INVERTER AUTOMATION TEST SUITE" -ForegroundColor Cyan
Write-Host "============================================================`n" -ForegroundColor Cyan

# Change to functions directory
Push-Location "$PSScriptRoot\functions"

try {
    # Run unit tests
    if ($Type -eq 'all' -or $Type -eq 'unit') {
        Write-Host "Running Unit Tests..." -ForegroundColor Yellow
        Write-Host "------------------------------------------------------------" -ForegroundColor Gray
        
        if ($Coverage) {
            npm test -- --coverage
        } else {
            npm test
        }
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "`nUnit tests FAILED" -ForegroundColor Red
            $testsFailed = $true
        } else {
            Write-Host "`nUnit tests PASSED" -ForegroundColor Green
        }
        
        Write-Host ""
    }
    
    # Run E2E tests
    if ($Type -eq 'all' -or $Type -eq 'e2e') {
        Write-Host "Running E2E Tests..." -ForegroundColor Yellow
        Write-Host "------------------------------------------------------------" -ForegroundColor Gray
        
        if ($Prod) {
            Write-Host "   Testing against: PRODUCTION" -ForegroundColor Magenta
            $env:TEST_ENV = "prod"
        } else {
            Write-Host "   Testing against: EMULATOR (localhost)" -ForegroundColor Cyan
        }
        
        if ($AuthToken) {
            Write-Host "   Authentication: TOKEN PROVIDED" -ForegroundColor Green
            $env:TEST_AUTH_TOKEN = $AuthToken
        } elseif ($SkipAuth) {
            Write-Host "   Authentication: SKIPPED" -ForegroundColor Yellow
            $env:SKIP_AUTH_TESTS = "true"
        } else {
            Write-Host "   Authentication: NONE (limited tests)" -ForegroundColor Yellow
        }
        
        node e2e-tests.js
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "`nE2E tests FAILED" -ForegroundColor Red
            $testsFailed = $true
        } else {
            Write-Host "`nE2E tests PASSED" -ForegroundColor Green
        }
        
        Write-Host ""
    }
    
    # Run auth flow tests
    if ($Type -eq 'auth') {
        Write-Host "Running Authentication Flow Tests..." -ForegroundColor Yellow
        Write-Host "------------------------------------------------------------" -ForegroundColor Gray
        Write-Host "   Note: Requires Firebase Auth emulator" -ForegroundColor Gray
        Write-Host "   Start with: firebase emulators:start --only auth,firestore,functions" -ForegroundColor Gray
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
    
    # Run integration tests
    if ($Type -eq 'all' -or $Type -eq 'integration') {
        Write-Host "Running Integration Tests..." -ForegroundColor Yellow
        Write-Host "------------------------------------------------------------" -ForegroundColor Gray
        
        if ($Prod) {
            Write-Host "   Testing against: PRODUCTION" -ForegroundColor Magenta
            $env:TEST_PROD = "true"
        } else {
            Write-Host "   Testing against: EMULATOR (localhost)" -ForegroundColor Cyan
            Write-Host "   Note: Start emulator first with: npm run serve" -ForegroundColor Gray
            Write-Host ""
        }
        
        node integration-test.js
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "`nIntegration tests FAILED" -ForegroundColor Red
            $testsFailed = $true
        } else {
            Write-Host "`nIntegration tests PASSED" -ForegroundColor Green
        }
        
        Write-Host ""
    }
    
    # Final summary
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
    
} finally {
    Pop-Location
}
