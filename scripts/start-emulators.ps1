# start-emulators.ps1
# Start Firebase emulators in the background

$logDir = 'logs'
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$stdout = Join-Path $logDir 'emulator.out.log'
$stderr = Join-Path $logDir 'emulator.err.log'

Write-Output "Starting emulators in background..."
Write-Output "Logs: $stdout"

# Use cmd /c to run npx firebase so it handles the path resolution correctly on Windows
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx firebase emulators:start --only functions,firestore,hosting,auth,pubsub,storage,database --import=./emulator-state --export-on-exit > $stdout 2> $stderr" -PassThru -WindowStyle Hidden

if ($proc) {
    $proc.Id | Out-File -FilePath 'emulator.pid' -Encoding ascii
    Write-Output "Emulators started with PID $($proc.Id)"
    Write-Output "Waiting for emulators to be ready..."
    
    # Wait up to 30 seconds for the UI port to be active
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        $conn = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
        if ($conn) {
            $ready = $true
            break
        }
    }
    
    if ($ready) {
        Write-Output "Emulators are READY at http://127.0.0.1:4000"
    } else {
        Write-Output "Emulators taking a long time to start. Check $stdout for progress."
    }
} else {
    Write-Output "Failed to start emulator process."
}
