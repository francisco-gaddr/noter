$ErrorActionPreference = "Stop"

Write-Host "Installerar/uppdaterar mlc-llm via pip..."
$cmd = Get-Command python -ErrorAction SilentlyContinue
if ($cmd) { $pythonCmd = $cmd.Source } else { $pythonCmd = "py" }
try {
  & $pythonCmd -m pip -V | Out-Null
} catch {
  $tmp = Join-Path $env:TEMP "get-pip.py"
  Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $tmp
  & $pythonCmd $tmp --user
  & $pythonCmd -m pip install --upgrade pip
}
& $pythonCmd -m pip install --pre -U -f https://mlc.ai/wheels mlc-llm-nightly-cpu mlc-ai-nightly-cpu

$pythonExe = & $pythonCmd -c "import sys; print(sys.executable)"
$pythonDir = Split-Path $pythonExe -Parent
$userBase = & $pythonCmd -m site --user-base
$pythonScripts = Join-Path $pythonDir "Scripts"
$tvmDir = Join-Path (Join-Path $pythonDir "Lib\\site-packages") "tvm"
$tvmLibDir = Join-Path $tvmDir "lib"
$torchLibDir = Join-Path (Join-Path $pythonDir "Lib\\site-packages\\torch") "lib"
$scriptsPath = Join-Path $userBase "Scripts"

$current = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $current) { $current = "" }

  $parts = @()
  if ($current.Trim().Length -gt 0) { $parts += $current }
  if ($current -notlike "*$scriptsPath*") { $parts += $scriptsPath }
  if ($current -notlike "*$pythonScripts*") { $parts += $pythonScripts }
  if ($current -notlike "*$tvmDir*") { $parts += $tvmDir }
  if ($current -notlike "*$tvmLibDir*") { $parts += $tvmLibDir }
  if ($current -notlike "*$torchLibDir*") { $parts += $torchLibDir }
  $newPath = ($parts -join ";")
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  $env:Path = $newPath
  Write-Host "PATH (User) uppdaterad."
  Write-Host "User Scripts: $scriptsPath"
  Write-Host "Python Scripts: $pythonScripts"
  Write-Host "TVM Dir: $tvmDir"
  Write-Host "TVM Lib Dir: $tvmLibDir"
  Write-Host "Torch Lib Dir: $torchLibDir"

  $mlcExe = Join-Path $pythonScripts "mlc_llm.exe"
  $mlcCmd = Join-Path $pythonScripts "mlc_llm.cmd"
  if (-not (Test-Path $mlcExe) -and -not (Test-Path $mlcCmd)) {
    "@echo off`r`n`"$pythonExe`" -m mlc_llm %*`r`n" | Set-Content -Path $mlcCmd -Encoding ASCII
    Write-Host "Skapade wrapper: $mlcCmd"
  }

Write-Host "Verifierar mlc_llm..."
try {
  where.exe mlc_llm
  mlc_llm --help | Select-Object -First 1
} catch {
  & $pythonCmd -m mlc_llm --help | Select-Object -First 1
}
