# RC Racing System — painel integrado

## App para Windows (recomendado)

Instale com `installer\RC-Racing-Setup.exe` (pede permissão de administrador). O instalador coloca o app em Arquivos de Programas, **instala o driver USB da placa ESP32 (Silicon Labs CP210x, assinado pela Microsoft)** e cria os atalhos **RC Racing** e **RC Racing - Diagnóstico**. Depois, é só abrir **RC Racing**:

1. O app liga o serviço, **acha o ESP32 sozinho** (qualquer porta COM com chip USB de ESP32; Bluetooth é ignorado) e reconhece o volante pelo Windows.
2. O painel abre numa janela própria, sem barra de navegador.
3. Aperte **A** no volante (contagem 3, 2, 1, GO) ou segure o acelerador 0,5 s para largar; **B** finaliza.

Se algo não for reconhecido, abra **RC Racing - Diagnóstico** (menu Iniciar): ele gera `RC Racing - diagnostico.txt` na área de trabalho com o que está OK e o que fazer (placa sem driver, volante no modo D, cabo só de carga, porta ocupada...). O próprio painel também mostra essas dicas no rodapé. Se a porta 8080 estiver ocupada, o app usa a próxima livre até 8089.

Fechar a janela encerra o app em alguns segundos e desliga os relés. Se uma corrida estiver em andamento, ele espera a corrida terminar. Enquanto houver outra janela do painel aberta (por exemplo uma aba do navegador em 127.0.0.1:8080), o app continua ligado. Logs: `%LOCALAPPDATA%\RC Racing\logs\app.log`.

Para gerar o instalador de novo após mudanças: `powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1` (usa Node, o Python de `.venv-controle`, PyInstaller e Inno Setup 6). O app fica em `build\pyinstaller\dist` e o instalador em `installer\`.

## Versão portátil (pen drive)

`powershell -ExecutionPolicy Bypass -File scripts\build-usb.ps1 -Drive D:` copia o app para o pen drive (pasta `RC Racing`, atalho `RC Racing.bat` na raiz, ícone da unidade e `LEIA-ME RC Racing.txt`). Em qualquer PC com Windows 10/11: conecte o pen drive, a placa e o volante e dê dois cliques em `RC Racing.bat`. Nada é instalado: o atalho roda uma cópia em `%LOCALAPPDATA%\RC Racing\portatil`, então tirar o pen drive com o painel aberto não derruba a corrida. A porta do ESP32 é detectada sozinha. Use `-Rebuild` para gerar o app de novo antes de copiar. O Windows não abre programas sozinho ao conectar um pen drive (proteção contra vírus), por isso o duplo clique.

## Modo desenvolvimento

`abrir_cockpit.bat` / `abrir_controle.bat` continuam funcionando e abrem a mesma tela em **http://127.0.0.1:8080** usando o código-fonte.

## Usar

- O painel inicia em **CARRINHO REAL**. Aguarde a indicação de placa conectada.
- Os indicadores K1–K4 mostram o estado **confirmado pelo ESP32**, não apenas o comando enviado.
- Com a corrida parada, clique em K1, K2, K3 ou K4 para um pulso de 0,5 segundo.
- **A corrida é controlada pelos botões do volante, sem tocar no painel:**
  - **A no volante** → contagem **3, 2, 1, GO** com som; o carrinho só é liberado no GO. B durante a contagem cancela.
  - **Segurar o acelerador 0,5 s** → larga na hora. Um toque mais curto cancela ("Início cancelado").
  - **B no volante** → a corrida termina.
  - **15 s sem acelerar** → a corrida termina por inatividade.
  - Depois de qualquer parada, solte o acelerador antes de largar de novo. Segurar A ou B não repete o comando.
  - Os botões ficam em `START_BUTTON` / `FINISH_BUTTON` (`backend/server.py`). Na simulação, use INICIAR (A) / CANCELAR / FINALIZAR (B) na tela ou os botões A/B do volante.
- **Ranking e histórico:** toda corrida real é salva num banco SQLite embutido (`%LOCALAPPDATA%\RC Racingc-racing.db`, um arquivo só, sem servidor). Durante a corrida, toque na **bandeira** a cada volta. Ao finalizar abre o resultado (tempo, melhor volta, posição); o botão 🏆 no topo mostra **Melhores voltas**, **Mais voltas** e **Histórico**. O nome do piloto é editado ali e vale para as próximas corridas. Corridas de simulação não entram no ranking. Para zerar, apague o arquivo `rc-racing.db` com o app fechado.
- **Som:** motor sintetizado que responde ao acelerador (marchas virtuais, ronco e assobio), bipes de largada, GO e fanfarra de bandeirada. O alto-falante no topo do painel liga/desliga o som; as barras ao lado mostram o giro do motor. A contagem também é falada em inglês ("Three, Two, One, Go!") por uma voz neural en-US gravada em `public/voice/`; para regravar: `.\.venv-controle\Scripts\edge-tts --voice en-US-GuyNeural --rate=+5% --text "Three!" --write-media public\voice\3.mp3`. Código em `web/src/audio/`.
- RT/RB aciona K1; LT/LB aciona K2; direita aciona K3; esquerda aciona K4. K2 pode ser freio ou ré, conforme a ligação do controle RC original.
- Trocar de janela, minimizar ou fechar o painel **não** para a corrida: o backend lê o volante pelo Windows. **PARAR** e **ESC** (de qualquer janela), desconexão do ESP32 ou perda do volante desligam os relés.
- A bandeira registra voltas manualmente. Ajustes de sensibilidade valem para a simulação e para volantes lidos pelo navegador; o volante lido pelo Windows aciona os relés direto. Os relés continuam sendo saídas liga/desliga, sem potência proporcional.
- O volante é lido pelo Windows/XInput automaticamente, com leitura pela Gamepad API quando o navegador reconhece um mapeamento padrão. Nenhuma janela Python adicional é necessária.
- Uma única janela tem autorização de controle. Outras ficam em observação. O botão ASSUMIR CONTROLE transfere o comando para a janela atual e desliga os relés antes da transferência. Ao fechar a janela principal, a próxima pode assumir, sempre com a sessão parada.
- **SIMULAÇÃO** permite testar os sliders sem enviar comandos à placa. Também pode ser aberta em `http://127.0.0.1:8080/?mode=simulation`.

O ESP32 atual só confirma os relés. Velocidade, bateria, temperatura, sinal de rádio e posição não são medidos e ficam sem dados no modo real. Na simulação esses campos são fictícios e identificados. O mapa utiliza a imagem fornecida em `public/`; a trajetória virtual é ilustrativa.

## Arquitetura

`Volante USB → painel React → WebSocket → backend Python → USB (porta COM detectada) → ESP32 → relés`

O backend também lê XInput e envia a entrada física para o painel. A máscara confirmada retorna por `ESTADO n`. O firmware permanece em `src/main.cpp`; frontend em `web/src`; backend em `backend/`.

O backend abre a serial com 115200 baud, consulta `Pronto CONTROLE v5`, envia `a`–`p` para as máscaras e `S` para parada. As regras de largada/encerramento ficam em `backend/control.py` (a simulação usa as mesmas regras em `web/src/raceRules.ts`). Atualiza a saída a cada 150 ms, exige confirmações recentes e reconecta quando a porta falha. Se o volante vier do navegador e parar de chegar por 400 ms, a corrida termina; sem confirmação serial por 750 ms, desliga/reconecta. O firmware mantém seu watchdog independente de 600 ms.

O serviço escuta apenas em `127.0.0.1:8080`, aceita WebSocket de origens locais autorizadas e permite apenas um controlador. O endpoint `/health` é somente leitura. O frontend estático é servido da pasta `dist/`, sem expor o restante do projeto.

## Desenvolvimento

```powershell
.\.venv-controle\Scripts\python.exe -m pip install -r requirements-cockpit.txt
npm install
npm run build
.\.venv-controle\Scripts\python.exe -m backend.server
```

Para hot reload, execute `npm run dev` em outro terminal e abra 127.0.0.1:5173. Use apenas uma janela real de controle. A porta serial é detectada automaticamente; para forçar uma, use `--serial-port COM8`.

Logs: `.cockpit-logs/bridge.log` e `.cockpit-logs/bridge-error.log`. O firmware não precisa ser regravado para esta integração.

## Protocolo

WebSocket em `/ws/telemetry`. Telemetria a 20 Hz, controles limitados a 25 Hz:

```json
{
  "type": "telemetry",
  "data": {
    "connected": true,
    "carEnabled": false,
    "relayMask": 0,
    "requestedMask": 0,
    "controlAvailable": true,
    "port": "COM7",
    "phase": "idle",
    "usbConnected": true,
    "usbInput": { "steering": 0, "throttle": 0, "brake": 0 },
    "speed": null,
    "battery": null,
    "signal": null,
    "temperature": null,
    "position": null
  }
}
```

A telemetria também traz `phase` (`idle`, `starting`, `countdown`, `running`, `finished`, `pulse`), `countdown` (segundos até o GO ou `null`) e `raceId`.

Comandos aceitos do proprietário da conexão:

```json
{"type":"relay","data":{"relay":3}}
{"type":"control","data":{"steering":0,"throttle":50,"brake":0,"start":false,"finish":false}}
{"type":"stop","data":{}}
```

`stop` é aceito de qualquer janela. `control` só é usado quando o Windows não detecta o volante. Pulsos de teste são aceitos somente com a corrida parada; comandos inválidos desligam as saídas.

## Testes

```powershell
npm run build
npm test
.\.venv-controle\Scripts\python.exe -m unittest backend.test_control backend.test_server -v
npx playwright test
```

Os testes usam placa e WebSocket simulados, sem acionar hardware real. Os testes de navegador usam o servidor Vite em 127.0.0.1:5173 e Edge instalado. A verificação física de comunicação usa apenas consulta de estado e parada.

Referências: [aiohttp](https://docs.aiohttp.org/en/stable/web_reference.html), [Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API).

