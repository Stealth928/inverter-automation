# reset-emulator-state.ps1
# One-step reset for local Firebase emulator suite.
# Actions:
# - Stop emulators and remove workspace emulator exports
# - Remove local Firebase emulator caches
# - Start emulators
# - Clear Firestore & Auth (shared/serverConfig + user docs + auth user)
# - Seed test data (auth user, profile, sample rule, history)
# - Verify setup status

Set-StrictMode -Version Latest

Write-Output "Starting full emulator reset..."

# Stop running emulators (best-effort)
if (Test-Path '.\scripts\stop-emulators.ps1') {
    Write-Output "Calling existing stop-emulators.ps1 for best-effort stop"
    try { .\scripts\stop-emulators.ps1 } catch { Write-Output "stop-emulators.ps1 error (ok): $($_.Exception.Message)" }
}

# Remove workspace export/state folders
$paths = @('.firebase','firebase-export*','emulator-state')
foreach ($p in $paths) {
    Get-ChildItem -Path . -Filter $p -ErrorAction SilentlyContinue | ForEach-Object {
        try { Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue; Write-Output "Removed $($_.FullName)" } catch { }
    }
}

# Remove emulator caches under user profile
$cache="$env:USERPROFILE\.cache\firebase"
if (Test-Path $cache) { Remove-Item -Recurse -Force $cache -ErrorAction SilentlyContinue; Write-Output "Removed $cache" }
$roam="$env:APPDATA\firebase"
if (Test-Path $roam) { Remove-Item -Recurse -Force $roam -ErrorAction SilentlyContinue; Write-Output "Removed $roam" }
Get-ChildItem $env:TEMP -Filter 'hub-*.json' -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue; Write-Output "Removed $_.FullName" }
Remove-Item -Force emulator.pid -ErrorAction SilentlyContinue

# Start emulators
Write-Output "Starting emulators (background)..."
.\scripts\start-emulators.ps1
Start-Sleep -Seconds 4

# Ensure emulators are reachable
$maxTries = 10
$try = 0
$uiReady = $false
while ($try -lt $maxTries) {
    try {
        $r = Invoke-RestMethod -Uri 'http://127.0.0.1:4000' -Method Get -TimeoutSec 3 -ErrorAction Stop
        $uiReady = $true; break
    } catch { Start-Sleep -Seconds 1; $try++ }
}
if (-not $uiReady) { Write-Output "Warning: Emulator UI did not respond after start." }

# Clear Firestore/Auth using Node helper (which uses admin SDK against emulator)
Write-Output "Clearing Firestore & Auth via functions/scripts/clear-firestore.js"
Push-Location functions
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'
node .\scripts\clear-firestore.js
Pop-Location

# Seed the emulator with baseline data
Write-Output "Seeding emulator state (auth, config, sample rule & history)"
Push-Location functions
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'
node .\scripts\seed-emulator-state.js
Pop-Location

# Verify setup status (retry a few times until functions are responsive)
Write-Output "Verifying setup status via /api/config/setup-status"
$max = 12
$attempt = 0
$ok = $false
while ($attempt -lt $max) {
    try {
        $status = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/config/setup-status' -Method Get -TimeoutSec 5 -ErrorAction Stop
        Write-Output "Setup status: setupComplete=$($status.result.setupComplete), source=$($status.result.source)"
        $ok = $true; break
    } catch {
        $errMsg = $_.Exception.Message -replace "\r|\n", ' '
        Write-Output ("Attempt {0}/{1}: service not ready yet - {2}" -f ($attempt+1), $max, $errMsg)
        Start-Sleep -Seconds 2
        $attempt++
    }
}
if (-not $ok) { Write-Output "Warning: Could not verify setup status after $max attempts. Check emulator logs at logs/emulator.out.log" }

Write-Output "Reset complete. You can now open http://127.0.0.1:4000 (Emulator UI) and http://127.0.0.1:5000 (Hosting)."
