# Starts a pipeline script detached from the caller (no inherited console handles), minimised.
# Usage: powershell -File ugap\launch.ps1 ugap_crawl.py crawl --delay 0.7
$Root = Split-Path -Parent $PSScriptRoot
$Py = Join-Path $Root ".claude_runner\venv\Scripts\python.exe"
$env:PYTHONIOENCODING = "utf-8"
Start-Process -FilePath $Py -ArgumentList (@("-u", (Join-Path $PSScriptRoot $args[0])) + $args[1..($args.Count)]) `
  -WorkingDirectory $Root -WindowStyle Minimized
Write-Output "launched $($args -join ' ')"
