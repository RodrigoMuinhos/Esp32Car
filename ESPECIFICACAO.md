# RC Racing — especificação do produto

Documento de referência: **o que o programa é e o que ele faz hoje**. O passo a passo (o que falta e a próxima ação) está em [ROTEIRO.md](ROTEIRO.md). Uso no dia a dia e protocolo: [README-cockpit.md](README-cockpit.md). Instalação numa máquina nova: [CLAUDE.md](CLAUDE.md).

Atualizado em 10/10/2026.

> **Validação:** a versão 1.1 (1 carrinho) foi validada com hardware real. **Tudo o que veio depois** (frota de vários carrinhos, assistente de controle, bateria, eventos, TOP 8, nova identidade visual) **foi testado só em simulação.** A validação em hardware é uma etapa separada (ROTEIRO, etapa 1).

## 1. O que é

Sistema que transforma carrinhos de controle remoto comuns numa experiência de corrida para eventos em shopping (Hot Wheels). O participante senta num cockpit com volante e pedais e dirige o carrinho real na pista, com contagem de largada, sons, tela de dados, câmera aérea e ranking.

Caminho do comando:

```
Volante + pedais (USB, XInput)
  -> servidor Python no PC Central (regras da corrida, fonte única da verdade)
  -> USB serial -> placa ESP32 (firmware C++)
  -> 4 relés (K1 acelera, K2 freio/ré, K3 direita, K4 esquerda) -> controle RC original -> carrinho
  <- a placa confirma cada comando ("ESTADO n")
Telas no navegador (painel do operador, tablets, telão) <- dados ao vivo por WebSocket
```

## 2. Princípios (não negociáveis)

1. **O servidor é a única fonte de verdade.** As telas mostram; não calculam tempo, posição nem resultado.
2. **O número de cockpits é um parâmetro** (padrão 4, até 16). Código novo nunca supõe 4.
3. **A corrida não depende de internet.** Nenhuma ação remota move um carro.
4. **O operador não dirige pelo painel.** Ele monitora, valida, intervém tecnicamente (parar, autoteste, bateria, sincronizar) e gerencia o ranking. Só o volante do cockpit conduz.
5. **Participantes são anônimos** (sessão + cockpit + carrinho, ex.: "03 VERMELHO"). Nome só existe se a pessoa se cadastrar pelo QR (fase D).
6. **Segurança primeiro:** PARAR, ESC, perda da placa, perda do volante ou falta de confirmação desligam os relés. Teste que liga relé só com o carrinho suspenso e com confirmação.
7. **PC Central / Unidade de Controle** (nunca "Mini PC"): computador dimensionado para a instalação (CPU, memória, GPU para várias telas, hubs USB alimentados, rede dedicada, disco local para banco e logs).

## 3. Hardware

| Parte | O quê | Situação |
|---|---|---|
| PC Central | Windows 10/11; roda servidor, painel e banco | Validado (1 carrinho) |
| Placa ESP32 + 4 relés | 1 por carrinho, via USB (CP210x) | Validada com firmware v5 |
| Firmware v6 | Placa se apresenta com o ID do chip (plug & play) | Compila; **não gravado** |
| Volante + pedais | Logitech em modo XInput (Xbox 360) | Validado (1 volante) |
| Limite XInput | Windows entrega no máximo **4 volantes** | Acima de 4: modo D (DirectInput), a fazer |
| Câmera aérea | Logitech C920 na Visão Piloto / telão | Testada |
| Tablets | Um por cockpit, pelo Wi-Fi local (`?vaga=N&view=piloto`) | Só simulação |

## 4. Regras da corrida (por cockpit)

Regras só em `backend/control.py` (com testes); a SIMULAÇÃO roda no servidor com as mesmas regras.

- **A** no volante: contagem 3-2-1-GO com som e voz; o carrinho só é liberado no GO. B durante a contagem cancela.
- **Acelerador segurado 0,5 s:** larga na hora; toque curto cancela.
- **B** finaliza; **15 s sem acelerar** finaliza por inatividade; **X** = pânico (para o carro).
- Depois de qualquer parada, soltar o acelerador antes de largar de novo.
- Modos: livre, 3 voltas ou 5 voltas. Limitador de giro (acelerador no máximo no limite corta a ignição).
- **Carrinho bloqueado** (vaga não configurada ou bateria ≤ 5%) não larga por nenhum caminho (A, acelerador, LARGAR TODOS). Uma corrida em andamento não é interrompida.

## 5. Frota e vagas

- N cockpits (configuração `cockpits` no banco ou `--cockpits N`). Canais de volante separados (`wheels`, XInput = 4). Vagas utilizáveis = `min(cockpits, volantes)`.
- **16 cores com nome único** (`CAR_NAMES` em `backend/fleet.py`, espelhado em `frontend/src/slots.ts`; um teste confere): 01 AZUL ELÉTRICO … 16 ÍNDIGO.
- **Vagas configuradas uma de cada vez.** Só a próxima livre mostra **+ ADICIONAR CONTROLE**. Assistente:
  1. escolher a cor (uma cor por vaga; ela dá o nome ao carrinho);
  2. alinhar o controle (segurar A + B por 2 s);
  3. confirmar volante e pedais (esquerda, direita, acelerador e freio no fundo);
  4. comunicação com a placa (**USAR ESTA PLACA** se houver placa livre).
- Vagas seguintes aparecem como "VAGA 0N — NÃO CONFIGURADA".
- **Plug & play:** placa plugada faz autoteste dos relés e entra na primeira vaga livre; placa conhecida volta para a sua vaga; reserva entra sozinha se só uma vaga estiver sem carrinho.
- **Sincronizar volante:** clicar no carrinho e segurar A + B por 2 s no volante do cockpit. Durante a sincronização, A/B/Y de todos ficam sem efeito (X continua parando).
- **Remover/desconfigurar uma vaga:** ainda não existe.

## 6. Bateria

- 30 min por carga, contados no servidor enquanto a bateria está marcada **LIGADO**; o tempo fica salvo no banco.
- Avisos: 20% (aviso), 10% (insistente), **5% = NÃO PODE RODAR** (bloqueia a largada).
- Clicar na bateria → **ZERAR** = 100%, "BATERIA OK".
- O ESP32 não mede a bateria: é estimativa por tempo de uso.

## 6A. Aceite técnico (Central Técnica)

- 7 verificações: comunicação com a placa, volante, pedais, relés (um de cada vez, depois de **CONFIRMAR ÁREA LIVRE**), parada de emergência (relés confirmados desligados em até 300 ms), câmera (FPS ≥ 15; abaixo de 24 aprova com atenção) e áudio (auxiliar).
- Estados de cada item: AGUARDANDO · TESTANDO · APROVADO · FALHA. **UNIDADE APTA** só com todos os críticos aprovados.
- **Com evento aberto, o carrinho só larga depois do aceite.** Invalida o aceite: novo evento, placa sem comunicação por 5 s, placa reiniciou, volante trocado, carrinho (placa) trocado, parada de emergência.
- **PARADA DE EMERGÊNCIA** (técnico): relés desligados, carrinho travado até RESET, e o aceite precisa ser refeito.
- Estado único por carrinho, calculado no servidor: OFFLINE · CONECTANDO · PRONTO · TESTANDO · ATENÇÃO · FALHA · EMERGÊNCIA.
- Cada aceite completo fica no banco (carrinho, placa, evento, resultado, itens).

## 7. Evento, sessões e ranking

- **SEM EVENTO ABERTO = treino:** voltas são salvas, mas não contam para recorde nem ranking.
- **ABRIR EVENTO** (com nome) / **ENCERRAR EVENTO** (confirmação em dois passos).
- Cada volta é salva no banco **no momento em que fecha** (se o app cair, as voltas ficam). Corridas interrompidas são marcadas ao reiniciar.
- Cada participação é uma **sessão anônima** com código de 6 caracteres (sem 0/O e 1/I).
- **Melhor volta do evento** sempre no topo (Mecânico e Corrida). **NOVO MELHOR TEMPO / RECORDE DO EVENTO** com som, só no PC Central.
- **TOP N provisório** (`top_n`, padrão 8) com linha de corte, tempo de corte e quem está logo abaixo. Todos os participantes ficam guardados (aba **Evento** no 🏆).
- Avisos silenciosos: ENTROU NO TOP 8, SAIU DO TOP 8, NOVO TEMPO DE CORTE.
- O cartão de cada carrinho mostra "SESSÃO #… · POSIÇÃO PROVISÓRIA #n · NO TOP / FORA DO CORTE".
- Limite atual: sem cadastro, a mesma pessoa correndo duas vezes aparece duas vezes.
- A SIMULAÇÃO é uma arena separada no servidor (banco próprio): eventos, voltas, ranking e aceites dela nunca se misturam com o real.

## 8. Telas

| Tela | Endereço | Para quem | O que mostra |
|---|---|---|---|
| Visão Mecânico — grade | `?view=mecanico&grade=4` (1/4/8/16) | Operador | Cartões leves (sem animação): placa, volante, relés, bateria, sessão; trilho lateral para trocar a grade; padrão 4 |
| Central Técnica (individual) | `grade=1`, aberta a partir do carrinho selecionado na grade | Técnico / operador | Aceite técnico (7 itens), comunicação com a placa, volante e pedais com valor bruto, relés, câmera, áudio, status, log, PARADA DE EMERGÊNCIA + RESET. Fixa no carrinho (sem seletor). Especificação: [CENTRAL_TECNICA.md](CENTRAL_TECNICA.md) |
| Visão Corrida | `?view=corrida` | Operador | Cartões das vagas configuradas, LARGAR TODOS 3-2-1, PARAR TODOS, modo, câmera, classificação, evento e TOP 8 |
| Visão Piloto (cockpit) | `?vaga=N&view=piloto` | Participante | **HUD de piloto** sobre a moldura `frontend/public/hud/pilot-frame.png`: câmera encaixada na janela da moldura (borda escura), moldura com brilho e leve transparência por cima; cronômetro e melhor volta no topo, posição no canto superior direito, 4 primeiros (por cor) à esquerda, volta no círculo esquerdo, velocidade estimada no mostrador direito; centro livre para dirigir. Canto superior esquerdo: VISÕES e controles da câmera |
| Telão | `?tela=telao` (+ `&mode=simulation` na simulação) | Público | **Transmissão** sobre a moldura `frontend/public/hud/telao-frame.png`, só leitura: câmera dominante na janela da moldura; placar à direita (PRÓXIMA CORRIDA → CLASSIFICAÇÃO com diferença para o líder → RESULTADO FINAL por 2 min 30 s), caixas CORRIDA (volta, tempo, líder) e MELHOR VOLTA (destaque ao bater), barra inferior; contagem 3-2-1 e ÚLTIMA VOLTA sobre o vídeo. Nada operacional |
| Ranking 🏆 | botão no topo | Operador | Evento, Melhores voltas, Mais voltas, Histórico (por carrinho, sem nomes) |
| SIMULAÇÃO | botão SIMULAÇÃO / `?mode=simulation` | Treino, teste e validação | **As mesmas telas** sobre a arena simulada do servidor: 16 carrinhos e pilotos virtuais, banco separado, começa pronta para teste. Selo sempre visível. O modo real nunca mostra nada simulado |

Comandos gerais (largar, parar todos, configurar) só funcionam no próprio PC Central. Os tablets só aceitam rede local/privada.

## 9. Identidade visual

- Tokens de cor num arquivo só: `frontend/src/theme.css`. Paleta: Azul Grafite #172331, Areia #F2EBDD, Hot Wheels Blue #1769D2, Flame Orange #F47A32, Warm Gray #A9A59D, #6F7478. Sem #000 nem #FFF.
- **Três conceitos separados:**
  - **cor do carrinho** = só identidade (faixa, bloco do número, tom discreto);
  - **estado operacional** = grafite/laranja (seleção em laranja, nunca na cor do carrinho);
  - **alerta/perigo** = laranja para avisos e vinho `--danger #8E1B1B`, só para PARAR, falhas e bloqueios;
  - **aprovado** = verde técnico `--ok #3FAE6A`, só em status (APROVADO, ONLINE, UNIDADE APTA), nunca em botão comum nem como identidade.
- A cor do carrinho nunca comunica erro, sucesso ou bloqueio.
- Telão e Visão Piloto em fundo escuro (#172331).

## 10. Dados

- SQLite, um arquivo: `%LOCALAPPDATA%\RC Racing\rc-racing.db` (simulação: `rc-racing-simulado.db`). Fora do Git (`.gitignore`).
- Tabelas: corridas (com `event_id` e código de sessão), voltas (com horário), eventos, aceites técnicos, configurações (`cockpits`, `top_n`, cores e placas das vagas, bateria, mapa de volantes, autoteste).
- `GET /api/ranking` entrega o ranking; a frota vai ao vivo na telemetria do WebSocket.

## 11. Entrega e testes

- **App Windows:** instalador (`scripts/build-installer.ps1`, instala o driver CP210x) e versão portátil em pen drive (`scripts/build-usb.ps1`). Diagnóstico: `RC Racing.exe --diagnostico`.
- **Testes automáticos** (sem hardware): servidor 78 (unittest), painel (Vitest), navegador 20 (Playwright no Edge).
- **Simulação:** o servidor sempre sobe a arena real e a arena SIMULAÇÃO (`?simulacao=1`); o painel escolhe pelo botão SIMULAÇÃO / CARRINHO REAL.

## 12. Fora do escopo atual (ver ROTEIRO)

Sensores de volta na pista, aceleração proporcional, modo D para mais de 4 volantes, cadastro por QR, painel remoto na internet, congelamento e TOP 8 oficial, final da cidade e ranking nacional, vídeo nos tablets, menu técnico.
