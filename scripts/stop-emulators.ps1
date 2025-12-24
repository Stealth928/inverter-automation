# stop-emulators.ps1
# Aggressively kill any processes on Firebase Emulator ports

$ports = @(4000, 4400, 5000, 5001, 8080, 8085, 9000, 9099, 9199)
Write-Output "Checking ports: $($ports -join ', ')"

foreach ($port in $ports) {
    $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conns) {
        $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($p in $pids) {
            try {
                $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
                if ($proc) {
                    Write-Output "Killing process $($proc.ProcessName) (PID $p) on port $port"
                    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
                }
            } catch {
                Write-Output "Failed to kill PID $($p): $($_.Exception.Message)"
            }
        }
    }
}

# Also kill any stray java processes that look like emulators
Get-Process -Name java -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
        if ($cmd -like "*firebase-tools*" -or $cmd -like "*cloud-firestore-emulator*" -or $cmd -like "*pubsub-emulator*") {
            Write-Output "Killing stray emulator Java process: PID $($_.Id)"
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}

if (Test-Path 'emulator.pid') { Remove-Item 'emulator.pid' -Force -ErrorAction SilentlyContinue }

Write-Output "Stop complete."