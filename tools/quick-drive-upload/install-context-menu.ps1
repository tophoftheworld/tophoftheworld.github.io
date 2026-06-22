#Requires -Version 5.0
<#
.SYNOPSIS
  Registers Explorer right-click "Upload to Google Drive" for the current user (HKCU).

.PARAMETER CommandLine
  Full command template including "%1" for the selected path, e.g.
  '"C:\Apps\upload-to-drive.exe" "%1"'
  If omitted, uses Python + main.py in this script's directory (prefers `py -3` when `py` is found).

.EXAMPLE
  .\install-context-menu.ps1

.EXAMPLE
  .\install-context-menu.ps1 -CommandLine '"C:\Tools\upload-to-drive.exe" "%1"'
#>
param(
    [Parameter(Mandatory = $false)]
    [string] $CommandLine = ""
)

$ErrorActionPreference = "Stop"
$scriptRoot = $PSScriptRoot
$shellName = "QuickDriveUpload"
$label = "Upload to Google Drive"

if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    $mainPy = Join-Path $scriptRoot "main.py"
    if (-not (Test-Path -LiteralPath $mainPy)) {
        Write-Error "main.py not found next to this script: $mainPy"
        exit 1
    }
    $pyCmd = Get-Command py -ErrorAction SilentlyContinue
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    $python3Cmd = Get-Command python3 -ErrorAction SilentlyContinue

    if ($null -ne $pyCmd) {
        $launcher = $pyCmd.Path
        $CommandLine = "`"$launcher`" -3 `"$mainPy`" `"%1`""
    }
    elseif ($null -ne $pythonCmd) {
        $launcher = $pythonCmd.Path
        $CommandLine = "`"$launcher`" `"$mainPy`" `"%1`""
    }
    elseif ($null -ne $python3Cmd) {
        $launcher = $python3Cmd.Path
        $CommandLine = "`"$launcher`" `"$mainPy`" `"%1`""
    }
    else {
        Write-Error "Python not found (py, python, python3). Install Python or pass -CommandLine."
        exit 1
    }
}

if ($CommandLine -notlike '*%1*') {
    Write-Error 'CommandLine must include "%1" (Explorer replaces it with the file or folder path).'
    exit 1
}

function Register-ShellCommand {
    param([string]$ClassPath)
    $key = "HKCU:\Software\Classes\$ClassPath\shell\$shellName"
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -LiteralPath $key -Name "MUIVerb" -Value $label
    $cmdKey = Join-Path $key "command"
    New-Item -Path $cmdKey -Force | Out-Null
    Set-ItemProperty -LiteralPath $cmdKey -Name "(default)" -Value $CommandLine
}

Register-ShellCommand -ClassPath "*"
Register-ShellCommand -ClassPath "Directory"

Write-Host "Registered context menu entries:"
Write-Host "  HKCU:\Software\Classes\*\shell\$shellName"
Write-Host "  HKCU:\Software\Classes\Directory\shell\$shellName"
Write-Host "Command: $CommandLine"
