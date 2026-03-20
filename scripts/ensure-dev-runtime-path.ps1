# ensure-dev-runtime-path.ps1
# Ensures common local dev runtimes are discoverable even in stripped shell PATH environments.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Add-UniquePathEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Entry,
        [Parameter(Mandatory = $true)][System.Collections.Generic.List[string]]$List
    )

    if ([string]::IsNullOrWhiteSpace($Entry)) { return }
    if (-not (Test-Path $Entry)) { return }

    $normalized = $Entry.Trim().TrimEnd('\').ToLowerInvariant()
    foreach ($item in $List) {
        if ($item.Trim().TrimEnd('\').ToLowerInvariant() -eq $normalized) {
            return
        }
    }
    $List.Add($Entry) | Out-Null
}

$merged = New-Object System.Collections.Generic.List[string]

$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$processPath = $env:Path

foreach ($segment in @($machinePath, $userPath, $processPath)) {
    if ([string]::IsNullOrWhiteSpace($segment)) { continue }
    foreach ($part in $segment.Split(';')) {
        if (-not [string]::IsNullOrWhiteSpace($part)) {
            Add-UniquePathEntry -Entry $part -List $merged
        }
    }
}

# Common runtime locations on Windows developer machines.
Add-UniquePathEntry -Entry 'C:\Program Files\nodejs' -List $merged
Add-UniquePathEntry -Entry 'C:\Program Files\Git\cmd' -List $merged

$adoptiumRoot = 'C:\Program Files\Eclipse Adoptium'
if (Test-Path $adoptiumRoot) {
    $jdkBin = Get-ChildItem $adoptiumRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'bin' } |
        Where-Object { Test-Path (Join-Path $_ 'java.exe') } |
        Select-Object -First 1
    if ($jdkBin) {
        Add-UniquePathEntry -Entry $jdkBin -List $merged
    }
}

$env:Path = ($merged -join ';')
