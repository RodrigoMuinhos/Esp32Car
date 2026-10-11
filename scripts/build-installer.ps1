# Builds installer\RC-Racing-Setup.exe: panel (Vite) -> app (PyInstaller) -> installer (Inno Setup).
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$python = Join-Path $projectRoot '.venv-controle\Scripts\python.exe'

# Frontend (frontend/) -> frontend/dist; backend (backend/) -> the app.
& npm.cmd --prefix frontend run build
if ($LASTEXITCODE -ne 0) { throw 'Erro ao compilar o painel.' }

& $python -m pip install --quiet -r backend\requirements.txt pyinstaller pillow
if ($LASTEXITCODE -ne 0) { throw 'Erro ao instalar as ferramentas de build.' }

# App icon: the RC Racing steering wheel (frontend/public/icons/volante.png, made from frontend/arte/Favincon.png).
& $python -c "from PIL import Image; Image.open('frontend/public/icons/volante.png').save('packaging/rc-racing.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"
if ($LASTEXITCODE -ne 0) { throw 'Erro ao gerar o icone.' }

& $python -m PyInstaller --noconfirm --clean --windowed --name 'RC Racing' `
    --icon "$projectRoot\packaging\rc-racing.ico" --add-data "$projectRoot\frontend\dist;dist" --paths "$projectRoot" `
    --distpath build\pyinstaller\dist --workpath build\pyinstaller\work --specpath build\pyinstaller `
    backend\app.py
if ($LASTEXITCODE -ne 0) { throw 'Erro ao empacotar o app.' }

$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 nao encontrado. Instale com: winget install JRSoftware.InnoSetup' }
& $iscc /Q packaging\rc-racing.iss
if ($LASTEXITCODE -ne 0) { throw 'Erro ao gerar o instalador.' }
Write-Host "Instalador pronto: $(Join-Path $projectRoot 'installer\RC-Racing-Setup.exe')"
