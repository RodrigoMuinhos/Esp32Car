# RC Racing — guia para o Claude Code

Projeto: carrinho RC controlado por volante USB. Volante → painel React → WebSocket → backend Python → USB serial → ESP32 → 4 relés (K1 acelera, K2 freio/ré, K3 direita, K4 esquerda). Detalhes de uso e protocolo em `README-cockpit.md`. Responda ao usuário em português.

## Mapa do código

| Pasta/arquivo | O quê |
|---|---|
| `src/main.cpp`, `platformio.ini` | Firmware ESP32 "CONTROLE v5" (PlatformIO). Só regravar se a placa for nova. |
| `backend/control.py` | Regras da corrida (puro, testável): A = contagem 3-2-1, acelerador 0,5 s larga, B ou 15 s parado finaliza. |
| `backend/server.py` | Ponte serial + XInput (volante) + WebSocket em `127.0.0.1:8080`. Detecta a porta do ESP32 sozinho. |
| `backend/app.py` | Ponto de entrada do app Windows (abre a janela Edge `--app`, fecha junto com ela). |
| `web/src/` | Painel React/Vite. `raceRules.ts` espelha `control.py` para o modo simulação. `audio/` = sons sintetizados + voz. |
| `public/` | Imagens, fontes, `voice/*.mp3` (contagem "Three, Two, One, Go"). |
| `scripts/build-installer.ps1` | Gera `installer\RC-Racing-Setup.exe` (Vite → PyInstaller → Inno Setup). |
| `scripts/build-usb.ps1` | Copia o app portátil para um pen drive (`-Drive E:`). |
| `scripts/start-cockpit.ps1` / `abrir_cockpit.bat` | Modo desenvolvimento (roda do código-fonte). |

Ao mudar uma regra de corrida, mude **os dois**: `backend/control.py` e `web/src/raceRules.ts`, e os testes de ambos.

## Roteiro: deixar tudo usável numa máquina nova (Windows 10/11)

Siga em ordem. Verifique antes de instalar; só instale o que faltar. Instalações via `winget` são por usuário quando possível.

### 1. Ferramentas
Versões usadas na máquina original: Git 2.52, Node 24 (npm 11), Python 3.14, PlatformIO 6.2, Inno Setup 6.7.

```powershell
git --version;  node --version;  python --version
winget install --id Git.Git -e                 # se faltar
winget install --id OpenJS.NodeJS.LTS -e       # Node >= 20
winget install --id Python.Python.3.14 -e      # Python >= 3.11 (testes usam asyncio.timeout)
```
Depois de instalar, abra um terminal novo para atualizar o PATH.

### 2. Código
```powershell
git clone https://github.com/RodrigoMuinhos/Esp32Car.git
cd Esp32Car
```

### 3. Dependências
O ambiente Python **precisa** se chamar `.venv-controle` (os scripts usam esse caminho).
```powershell
python -m venv .venv-controle
.\.venv-controle\Scripts\python.exe -m pip install -r requirements-cockpit.txt
npm ci
npm run build
```

### 4. Testes (sem hardware)
```powershell
.\.venv-controle\Scripts\python.exe -m unittest backend.test_control backend.test_server
npm test
```
Testes de navegador (Playwright usa o Edge instalado; **exigem o Vite rodando em 127.0.0.1:5173**):
```powershell
npm run dev          # em outro terminal / em segundo plano
npx playwright test
```
Esperado: backend OK, 4 testes vitest, 12 testes Playwright.

### 5. Hardware
1. Conecte a placa ESP32 por USB. Ela deve aparecer como "Silicon Labs CP210x USB to UART Bridge (COMx)":
   ```powershell
   Get-CimInstance Win32_PnPEntity | Where-Object Name -match 'CP210|CH340|COM\d' | Select-Object Name, Status
   ```
   Se não aparecer: falta o driver CP210x. Com internet o Windows instala sozinho em segundos (reconecte o cabo). Senão, peça ao usuário para instalar o driver oficial da Silicon Labs.
2. Conecte o volante (Logitech, modo Xbox 360/XInput). Deve aparecer "Controlador XBOX 360 para Windows".
3. Rode em modo desenvolvimento e confira:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\start-cockpit.ps1
   Invoke-RestMethod http://127.0.0.1:8080/health   # espere connected=True, port=COMx, usbConnected=True
   ```
4. Placa nova, sem o firmware? Grave com PlatformIO (extensão do VS Code ou `pip install platformio`). Ajuste `upload_port`/`monitor_port` em `platformio.ini` para a COM real, depois `pio run -t upload`. Feche o app antes (ele ocupa a porta serial). A resposta esperada na serial é `Pronto CONTROLE v5`.

### 6. Instalar como app (opcional)
```powershell
winget install --id JRSoftware.InnoSetup -e --scope user
powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
.\installer\RC-Racing-Setup.exe        # cria atalho "RC Racing" na área de trabalho
```
Sem instalar nada: use o pen drive (`scripts\build-usb.ps1 -Drive E:` numa máquina com o build pronto) e dê dois cliques em `RC Racing.bat` no pen drive.

### 7. Pronto
Abrir o app (atalho, `RC Racing.bat` do pen drive ou `abrir_cockpit.bat`). Apertar **A** no volante: ignição, "Three, Two, One, Go", carrinho liberado. **B** finaliza. Detalhes em `README-cockpit.md`.

## Cuidados
- **Relés movem o carrinho de verdade.** Pulsos K1–K4 ou qualquer teste que ligue relés: confirme com o usuário antes, com o carrinho suspenso ou parado com segurança.
- Só um programa pode usar a porta serial: feche o app antes de gravar firmware ou rodar scripts antigos (`controle_reles.py`).
- Porta 8080 ocupada por outro programa impede o app de abrir.
- O app instalado/portátil carrega o painel compilado (`dist/`) dentro do executável: depois de mudar o frontend, gere o instalador/pen drive de novo para ver a mudança no app.
- Se o Vite servir um módulo vazio após reescrever um arquivo, faça `touch` no arquivo (cache do watcher).
- No Git Bash, `\v`, `\a`, `\b`, `\3` dentro de strings Python viram caracteres de controle: em caminhos Windows use `r"..."` ou `/`.
- Commits terminam com `Co-Authored-By: Claude ... <noreply@anthropic.com>`; envie ao GitHub (`origin/main`) só quando o usuário pedir ou já tiver combinado.
