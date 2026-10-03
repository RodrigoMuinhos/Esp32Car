param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$pythonPath = Join-Path $projectRoot '.venv-controle\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    & python -m venv (Join-Path $projectRoot '.venv-controle')
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel preparar o Python.' }
}
& $pythonPath -c 'import aiohttp, serial'
if ($LASTEXITCODE -ne 0) {
    & $pythonPath -m pip install -r requirements-cockpit.txt
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel instalar a ponte com a placa.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\vite\bin\vite.js'))) {
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel instalar o painel.' }
}
$indexPath = Join-Path $projectRoot 'dist\index.html'
$rebuild = -not (Test-Path -LiteralPath $indexPath)
if (-not $rebuild) {
    $buildTime = (Get-Item -LiteralPath $indexPath).LastWriteTimeUtc
    $rebuild = [bool](Get-ChildItem -Path (Join-Path $projectRoot 'web'),(Join-Path $projectRoot 'public') -Recurse -File | Where-Object { $_.LastWriteTimeUtc -gt $buildTime } | Select-Object -First 1)
}
if ($rebuild) { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Erro ao compilar o painel.' } }
# Release the serial port by closing only this project's legacy controller.
$legacyScripts = @((Join-Path $projectRoot 'diagnostico_controle.py'), (Join-Path $projectRoot 'controle_reles.py'))
$legacy = @(Get-CimInstance Win32_Process | Where-Object {
    $commandLine = $_.CommandLine
    $_.Name -match '^pythonw?\.exe$' -and $commandLine -and ($legacyScripts | Where-Object { $commandLine.Contains($_) })
})
foreach ($entry in $legacy) {
    $process = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
    if ($process) { $null = $process.CloseMainWindow() }
}
if ($legacy.Count) { Start-Sleep -Milliseconds 800 }
foreach ($entry in $legacy) {
    $process = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
    if ($process) { Stop-Process -Id $process.Id }
}
$url = 'http://127.0.0.1:8080'
$running = $false
try { $health = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 2; $running = $health.service -eq 'rc-cockpit' } catch {}
if (-not $running) {
    $logDirectory = Join-Path $projectRoot '.cockpit-logs'
    New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
    $server = Start-Process -FilePath $pythonPath -ArgumentList '-u','-m','backend.server' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'bridge.log') -RedirectStandardError (Join-Path $logDirectory 'bridge-error.log') -PassThru
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        if ($server.HasExited) { throw 'O servico encerrou. Confira .cockpit-logs\bridge-error.log.' }
        try { $health = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 1; if ($health.service -eq 'rc-cockpit') { $running = $true; break } } catch {}
    }
    if (-not $running) { throw 'O painel nao respondeu. Confira .cockpit-logs.' }
}
if (-not $NoBrowser) { Start-Process $url }
