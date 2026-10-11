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

## Evento com 4 carrinhos (Visão Corrida)

O número de cockpits é um **parâmetro da instalação** (padrão 4, até 16): configuração `cockpits` no banco ou `--cockpits N` ao iniciar o servidor. Hoje cada volante entra pelo XInput, que entrega no máximo 4 volantes; acima disso será preciso o modo D (DirectInput). Cores das vagas: **01 AZUL ELÉTRICO · 02 LARANJA · 03 VERMELHO · 04 ROXO** (as cores 05–16 já estão definidas para eventos maiores; nomes únicos em `CAR_NAMES`, `backend/fleet.py`). Tudo fica ligado ao **PC Central**: 4 placas ESP32 (USB), 4 volantes (o Windows aceita 4 controles XInput) e a câmera aérea.

- **Plug & play:** plugue a placa; o sistema a encontra, faz o **autoteste dos relés** e põe na primeira cor livre. Placa já conhecida volta para a sua cor. **Carrinho quebrou?** Desplugue e plugue um reserva: se só uma cor está sem carrinho, o reserva entra nela sozinho; senão aparece em "CARRINHO NOVO PLUGADO" para você escolher a cor.
- **Firmware v6** (`src/main.cpp`): a placa se apresenta com o número único do chip (`Pronto CONTROLE v6 ID ...`). Grave uma vez em cada placa. Placas v5 também funcionam, reconhecidas pela porta USB.
- **Adicionar controle (Visão Mecânico):** as vagas são configuradas uma de cada vez. Só a próxima vaga livre mostra **+ ADICIONAR CONTROLE**; as seguintes aparecem como "VAGA 0N — NÃO CONFIGURADA". O assistente pede: **1)** a cor do carrinho (16 cores; uma cor por vaga, e ela dá o nome ao carrinho), **2)** alinhar o controle (segure A + B por 2 s no volante), **3)** confirmar volante e pedais (todo à esquerda, todo à direita, acelerador e freio no fundo) e **4)** a comunicação com a placa (se houver placa plugada sem vaga, **USAR ESTA PLACA**). Ao concluir, a vaga funciona e o botão pula para a próxima. Vaga não configurada não larga. Hoje são até 4 vagas (limite de 4 volantes XInput do Windows).
- **Central Técnica (aceite):** na Visão Mecânico, selecione o carrinho na grade e clique em **1 INDIVIDUAL**. **INICIAR ACEITAÇÃO** verifica comunicação com a placa, volante (gire todo à esquerda e à direita), pedais (no fundo), relés K1→K4 (pede **ÁREA LIVRE**: carrinho suspenso), parada de emergência, câmera (ligue a câmera da pista) e áudio (responda se ouviu). **Com evento aberto, o carrinho só larga depois do aceite** (UNIDADE APTA). Trocar placa, volante, reiniciar a placa, perder a comunicação por 5 s, abrir novo evento ou acionar a **PARADA DE EMERGÊNCIA** (que trava o carrinho até **RESET**) pede um novo aceite. Valores que o carrinho não mede (tensão, temperatura, sinal) aparecem como N/D.
- **Evento (Abrir / Encerrar):** na faixa do topo da Visão Mecânico ou da Visão Corrida, **ABRIR EVENTO** (nome, ex.: "Fortaleza · Shopping X"). Só voltas dentro de um evento aberto contam para recorde e ranking; fora dele é **treino**. Cada participação é uma **sessão** anônima com código (ex.: #A28391). O **TOP 8 PROVISÓRIO** (N configurável: `top_n`) e o **tempo de corte** atualizam a cada volta; todos os participantes ficam no ranking (aba **Evento** do 🏆), não só os 8. Avisos: NOVO MELHOR TEMPO (com som), ENTROU NO TOP 8, SAIU DO TOP 8, NOVO TEMPO DE CORTE (só visuais). **ENCERRAR EVENTO** pede confirmação.
- **Voltas e recorde (painel do operador):** cada volta é salva no banco no momento em que fecha (sem digitar nada; se o app cair, as voltas ficam). A faixa **MELHOR VOLTA DO EVENTO** fica sempre no topo da Visão Mecânico e da Visão Corrida; quando alguém supera o recorde aparece **NOVO MELHOR TEMPO / NOVO RECORDE DO EVENTO** por alguns segundos, com som (só no PC Central). O operador não dirige pelo painel: no modo real só o volante do cockpit conduz.
- **Bateria:** cada carrinho tem 30 min por carga. Marque LIGADO ao ligar o carrinho; o tempo conta no PC Central. Avisos em 20% e 10%; em **5% ou menos o carrinho fica em NÃO PODE RODAR e não larga** (A, acelerador ou LARGAR TODOS) até trocar a bateria e clicar nela > **ZERAR**. Uma corrida já em andamento não é interrompida.
- **Volantes:** clique no cartão do carrinho (Visão Mecânico) ou em **SINCRONIZAR CONTROLE** (Visão Corrida) e segure **A + B juntos por 2 s** no volante daquele cockpit. Enquanto a sincronização está aberta, A, B e Y de todos os volantes ficam sem efeito (o X continua parando o carro).
- **Visão Corrida** (aba no topo, no PC Central): os 4 cartões (placa, volante, relés, voltas, tempos, PARAR, TESTAR, LIBERAR), **LARGAR TODOS 3-2-1**, **PARAR TODOS**, modo (livre/3/5 voltas), câmera e classificação ao vivo.
- **Tablets dos cockpits:** pelo Wi-Fi do roteador do evento, abra `http://<IP do PC Central>:8080/?vaga=1&view=piloto` (2, 3, 4 para as outras cores). O endereço aparece no quadro OPERAÇÃO. Comandos gerais só funcionam no próprio PC Central.
- **Telão:** `http://127.0.0.1:8080/?tela=telao` (botão ABRIR TELÃO): câmera + classificação 1º–4º nas cores.
- **SIMULAÇÃO (testar sem hardware):** o botão **SIMULAÇÃO** no topo mostra **exatamente as mesmas telas** do carrinho real (grade, Central Técnica, aceite, Visão Corrida, piloto, telão), mas numa **arena simulada do servidor**: 16 carrinhos e pilotos virtuais (placas SIM1…SIM16), banco separado (`rc-racing-simulado.db`). Ela sempre começa pronta para teste e validação (todas as vagas configuradas, baterias quase cheias com alguns avisos, aceite pendente). O selo azul **SIMULAÇÃO · NADA MOVE CARRINHO REAL** fica sempre visível. No modo **CARRINHO REAL** aparece só o que está ligado neste PC Central; nada simulado entra lá. `POST /api/simular?porta=SIM2&acao=desplugar` / `?porta=SIM17&acao=plugar` simula carrinho quebrado e reserva (só na simulação).
- Na primeira vez que o servidor escuta na rede, o Windows pergunta sobre o firewall: permita em **redes privadas**.

## Demonstração online (só SIMULAÇÃO)

O evento real roda no **PC Central** (placas na USB, volantes, rede local). Para mostrar o sistema pela internet existe um **modo demonstração**: só a arena SIMULAÇÃO, sem placas nem volantes, então nada pode mover um carrinho real.

- **Servidor (Railway, Render ou qualquer host com Docker):** o `Dockerfile` da raiz gera um serviço completo (painel + corrida simulada) com `python -m backend.server --demo`. Variáveis: `PORT` (o host define) e `RC_ORIGINS` = endereços dos painéis publicados que podem se conectar (ex.: `https://esp32-car-three.vercel.app`; `*` = qualquer um). O endereço do próprio serviço já abre o painel funcionando.
- **Painel no Vercel (raiz `frontend/`):** `frontend/vercel.json` gera o painel em modo demonstração (`VITE_DEMO=1`: abre na SIMULAÇÃO, sem CARRINHO REAL). Defina no Vercel a variável `VITE_SERVER_URL` = endereço HTTPS do servidor de demonstração e publique de novo.
- Sem servidor configurado, o painel publicado mostra "Este endereço só tem o painel" em vez de quebrar.

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
  - Os botões ficam em `START_BUTTON` / `FINISH_BUTTON` (`backend/server.py`). Na simulação, os pilotos virtuais conduzem; o operador não dirige pelo painel.
- **Ranking e histórico:** toda corrida real é salva num banco SQLite embutido (`%LOCALAPPDATA%\RC Racing\rc-racing.db`, um arquivo só, sem servidor). A volta é marcada pelo botão **Y** do volante (até existirem sensores na pista). Ao finalizar abre o resultado (tempo, melhor volta, posição); o botão 🏆 no topo mostra **Melhores voltas**, **Mais voltas** e **Histórico**. Pilotos não são identificados por nome: o ranking, a classificação e as telas mostram o carrinho (ex.: "03 VERMELHO"). A simulação tem ranking próprio e nunca se mistura com o real. Para zerar, apague o arquivo `rc-racing.db` com o app fechado.
- **Som:** motor sintetizado que responde ao acelerador (marchas virtuais, ronco e assobio), bipes de largada, GO e fanfarra de bandeirada. O alto-falante no topo do painel liga/desliga o som; as barras ao lado mostram o giro do motor. A contagem também é falada em inglês ("Three, Two, One, Go!") por uma voz neural en-US gravada em `frontend/public/voice/`; para regravar: `.\.venv-controle\Scripts\edge-tts --voice en-US-GuyNeural --rate=+5% --text "Three!" --write-media frontend\public\voice\3.mp3`. Código em `frontend/src/audio/`.
- RT/RB aciona K1; LT/LB aciona K2; direita aciona K3; esquerda aciona K4. K2 pode ser freio ou ré, conforme a ligação do controle RC original.
- Trocar de janela, minimizar ou fechar o painel **não** para a corrida: o backend lê o volante pelo Windows. **PARAR** e **ESC** (de qualquer janela), desconexão do ESP32 ou perda do volante desligam os relés.
- O volante lido pelo Windows aciona os relés direto. Os relés continuam sendo saídas liga/desliga, sem potência proporcional.
- O volante é lido pelo Windows/XInput automaticamente, com leitura pela Gamepad API quando o navegador reconhece um mapeamento padrão. Nenhuma janela Python adicional é necessária.
- Uma única janela tem autorização de controle. Outras ficam em observação. O botão ASSUMIR CONTROLE transfere o comando para a janela atual e desliga os relés antes da transferência. Ao fechar a janela principal, a próxima pode assumir, sempre com a sessão parada.
- **SIMULAÇÃO** também abre direto em `http://127.0.0.1:8080/?mode=simulation` (vale para tablets e telão: `?mode=simulation&vaga=2&view=piloto`).

O ESP32 atual só confirma os relés. Velocidade, bateria, temperatura, sinal de rádio e posição não são medidos e ficam sem dados no modo real. Na simulação esses campos são fictícios e identificados. O mapa utiliza a imagem fornecida em `public/`; a trajetória virtual é ilustrativa.

## Arquitetura

`Volante USB → painel React → WebSocket → backend Python → USB (porta COM detectada) → ESP32 → relés`

O backend também lê XInput e envia a entrada física para o painel. A máscara confirmada retorna por `ESTADO n`. O firmware permanece em `src/main.cpp`; frontend em `frontend/`; backend em `backend/`.

O backend abre a serial com 115200 baud, consulta `Pronto CONTROLE v5`, envia `a`–`p` para as máscaras e `S` para parada. As regras de largada/encerramento ficam em `backend/control.py` (a simulação usa as mesmas regras em `frontend/src/raceRules.ts`). Atualiza a saída a cada 150 ms, exige confirmações recentes e reconecta quando a porta falha. Se o volante vier do navegador e parar de chegar por 400 ms, a corrida termina; sem confirmação serial por 750 ms, desliga/reconecta. O firmware mantém seu watchdog independente de 600 ms.

O serviço escuta apenas em `127.0.0.1:8080`, aceita WebSocket de origens locais autorizadas e permite apenas um controlador. O endpoint `/health` é somente leitura. O frontend estático é servido da pasta `dist/`, sem expor o restante do projeto.

## Desenvolvimento

O projeto tem duas partes separadas, cada uma com suas dependências e seu deploy:
- **`backend/`** (Python): servidor, regras, frota, banco. Dependências em `backend/requirements.txt`.
- **`frontend/`** (React/Vite): o painel. `npm` roda dentro dessa pasta; o build vai para `frontend/dist`, que o backend serve (ou qualquer servidor de arquivos estáticos).

```powershell
.\.venv-controle\Scripts\python.exe -m pip install -r backend\requirements.txt
cd frontend; npm install; npm run build; cd ..
.\.venv-controle\Scripts\python.exe -m backend.server
```

Para hot reload, execute `npm run dev` dentro de `frontend/` em outro terminal e abra 127.0.0.1:5173. Use apenas uma janela real de controle. A porta serial é detectada automaticamente; para forçar uma, use `--serial-port COM8`.

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
.\.venv-controle\Scripts\python.exe -m unittest backend.test_control backend.test_server backend.test_fleet backend.test_history backend.test_acceptance
cd frontend
npm run build
npm test
npx playwright test
```

Os testes usam placa e WebSocket simulados, sem acionar hardware real. Os testes de navegador usam o servidor Vite em 127.0.0.1:5173 e Edge instalado. A verificação física de comunicação usa apenas consulta de estado e parada.

Referências: [aiohttp](https://docs.aiohttp.org/en/stable/web_reference.html), [Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API).

