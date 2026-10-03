# Copies the portable RC Racing app to a USB drive: plug it into any Windows PC
# and open "RC Racing.bat" (or the RC Racing folder). Nothing is installed on the PC.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\build-usb.ps1 [-Drive E:] [-Rebuild]
param([string]$Drive = 'D:', [switch]$Rebuild)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$app = Join-Path $projectRoot 'build\pyinstaller\dist\RC Racing'
$root = "$($Drive.TrimEnd('\'))\"
if (-not (Test-Path -LiteralPath $root)) { throw "Unidade $Drive nao encontrada." }

if ($Rebuild -or -not (Test-Path -LiteralPath (Join-Path $app 'RC Racing.exe'))) {
    & (Join-Path $PSScriptRoot 'build-installer.ps1')
}

# Mirror the app folder (removes files from older versions).
$target = Join-Path $root 'RC Racing'
& robocopy $app $target /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar o app para $target." }
Copy-Item -LiteralPath (Join-Path $projectRoot 'packaging\rc-racing.ico') -Destination (Join-Path $target 'rc-racing.ico') -Force

# One-click launcher at the drive root (works whatever letter the PC assigns).
Set-Content -LiteralPath (Join-Path $root 'RC Racing.bat') -Encoding ascii -Value @'
@echo off
start "" "%~dp0RC Racing\RC Racing.exe"
'@

# Drive icon and name in Explorer.
$autorun = Join-Path $root 'autorun.inf'
if (Test-Path -LiteralPath $autorun) { attrib -h -s -r $autorun }
Set-Content -LiteralPath $autorun -Encoding ascii -Value @'
[autorun]
icon=RC Racing\rc-racing.ico
label=RC Racing
'@
attrib +h +s $autorun

Set-Content -LiteralPath (Join-Path $root 'LEIA-ME RC Racing.txt') -Encoding utf8 -Value @'
RC Racing - versao portatil

1. Conecte este pen drive, a placa ESP32 (cabo USB) e o volante no PC.
2. Abra o pen drive e de dois cliques em "RC Racing.bat".
3. O app encontra a placa e o volante sozinho e abre o painel.
4. Aperte A no volante para largar (3, 2, 1, Go) e B para finalizar.

Nada e instalado no PC. Fechar a janela do painel encerra o app e desliga os reles.

Requisitos do PC: Windows 10 ou 11 (o Microsoft Edge ja vem instalado).
Se o painel mostrar "ESP32 nao encontrado" com a placa conectada, o PC ainda nao
tem o driver USB da placa (CP210x): com internet, o Windows instala sozinho em
alguns segundos; reconecte o cabo depois disso.
Logs do app neste PC: %LOCALAPPDATA%\RC Racing\logs\app.log
'@

Write-Host "Pen drive pronto em $root"
