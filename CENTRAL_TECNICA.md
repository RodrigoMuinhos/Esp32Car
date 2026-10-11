# Central Técnica — especificação (implementada, testada só em simulação)

Substitui a **Visão Individual** do mecânico. É um console de comissionamento, aceite, monitoramento e manutenção de **um carrinho**, não uma tela de corrida. Continua sendo aberta a partir do carrinho selecionado na grade. Parte do [ROTEIRO.md](ROTEIRO.md) (etapa 2A); regras gerais em [ESPECIFICACAO.md](ESPECIFICACAO.md).

Origem: anotação do Rodrigo (10/10/2026) com mockup "CENTRAL TÉCNICA · RC-03". Abaixo está adaptada ao que o sistema **realmente mede**. Regra: **nunca mostrar valor fictício**; o que não é medido aparece como **N/D** ou fica fora.

## 1. Perguntas que a tela responde
1. O carrinho está conectado?
2. Todos os periféricos funcionam?
3. Está seguro para operar?
4. Se houver falha, onde ela está?

Hierarquia: estado geral → aceite técnico → entradas → atuadores → telemetria → mídia → log → emergência. O bloco central (aceite) é o mais forte; os cards não têm o mesmo peso. **O mapa da pista sai desta tela.**

## 2. Layout (desktop/kiosk: 1920×1080, 1600×900, 1366×768; abaixo disso, rolagem)

```
HEADER: CENTRAL TÉCNICA · 03 VERMELHO — Verificação, diagnóstico e operação   [CARRINHO REAL] [COM7 · ONLINE]
Abas: VISÃO GERAL · DIAGNÓSTICOS · ACEITAÇÃO TÉCNICA · CONFIGURAÇÕES
┌ ENTRADAS ─────┬ ACEITAÇÃO / ATUADORES / STATUS ─┬ PEDAIS / CÂMERA ┐
├ LOG DO SISTEMA ─────────────────────────────────────────────────────┤
└ BARRA FIXA: unidade · resumo (PLACA OK · VOLANTE OK · VÍDEO OK · ÁUDIO OK) · RESET · PARADA DE EMERGÊNCIA
```

O indicador **CARRINHO REAL / SIMULAÇÃO** nunca some.

## 3. Painéis e o que cada um mostra de verdade

| Painel | Mostra | Adaptação ao nosso hardware |
|---|---|---|
| Direção · volante USB | ângulo, barra, faixa, valor bruto do eixo, zona morta, calibração | XInput dá o eixo bruto (−32768…32767). Faixa em graus depende do volante; até configurar, mostrar % e bruto |
| Pedais · entrada USB | acelerador e freio/ré: %, barra vertical, bruto, zona morta | Gatilhos XInput 0–255 (bruto real) |
| Comunicação com a placa | porta COM, versão do firmware (v5/v6) e ID da placa, tempo de confirmação (comando → `ESTADO n`), taxa de atualização, confirmações perdidas, última confirmação, reconexões | **A placa é USB serial, não Wi-Fi:** sem IP nem RSSI. "Perda de pacotes" = confirmações que não chegaram |
| Atuadores · relés | K1 ACELERAR, K2 FREIO/RÉ, K3 DIREITA, K4 ESQUERDA: estado confirmado pela placa + TESTAR | Já existe pulso de 0,5 s com a corrida parada |
| Status do carrinho | bateria (estimativa por tempo, %), estado dos relés, nível de comando, firmware, tempo ligado | Sem medição de tensão, temperatura nem sinal de rádio: **N/D** (ou fora) até existir sensor |
| Câmera · vídeo | prévia, resolução e FPS reais da câmera, estado, TESTAR IMAGEM | A câmera é **da instalação** (aérea, no PC Central), não do carrinho. Codec e latência: N/D |
| Áudio | saída, volume, estado, TESTAR SOM → "VOCÊ OUVIU O SOM? SIM / NÃO" | Som do PC Central (Web Audio) |
| Log do sistema | horário, gravidade (info/sucesso/aviso/erro), origem, mensagem | Novo: o servidor guarda os eventos do carrinho (conectou, caiu, reconectou, confirmação atrasada, parada de emergência, teste) |

## 4. Aceitação técnica

Tabela ITEM / STATUS / DETALHES, com quatro estados apenas: **AGUARDANDO · TESTANDO · APROVADO · FALHA**.

| Item | Como testar | Crítico? |
|---|---|---|
| Comunicação com a placa | consulta de estado; confirmação dentro do limite | Sim |
| Volante | operador gira tudo à esquerda e à direita (já existe no assistente) | Sim |
| Pedais | acelerador e freio no fundo (já existe no assistente) | Sim |
| Relés / atuadores | teste sequencial K1→K2→K3→K4, 500 ms cada, 500 ms de pausa, **depois de CONFIRMAR ÁREA LIVRE**; a placa precisa confirmar cada um | Sim |
| Parada de emergência | comanda parada e exige `ESTADO 0` confirmado em até X ms (é a parada por software; não existe circuito físico de emergência) | Sim |
| Câmera | imagem chegando com FPS ≥ 24 (15–23 atenção, < 15 falha) | Auxiliar (crítico se a pilotagem depender do vídeo) |
| Áudio | operador confirma que ouviu | Auxiliar |

Resumo ao lado: **7/7 · TESTES APROVADOS · UNIDADE APTA** ou **6/7 · 1 FALHA · UNIDADE BLOQUEADA**.

Botões: TESTAR SOM · TESTAR IMAGEM · TESTE DE COMUNICAÇÃO · TESTE SEQUENCIAL (só os não perigosos e os relés com confirmação) · **INICIAR ACEITAÇÃO** (fluxo guiado das 7 etapas).

## 5. Segurança (o servidor decide; a tela só pede)
- O painel nunca fala com a placa: tudo passa pelo servidor, que valida.
- **Falha crítica no aceite = carrinho bloqueado**, pelo mesmo mecanismo do bloqueio de bateria (não larga por nenhum caminho).
- Relés incompatíveis nunca juntos: K1+K2 e K3+K4 já são barrados em `control.py`; o teste sequencial liga um de cada vez.
- Antes de qualquer teste que mova o carrinho: **CONFIRMAR ÁREA LIVRE** — "O carrinho poderá se mover durante o teste." [CANCELAR] [ÁREA LIVRE · CONTINUAR].
- **PARADA DE EMERGÊNCIA** em dois lugares (área de relés e barra inferior), prioridade absoluta: relés desligados, nível de comando 0, estado EMERGÊNCIA.
- Estado único do carrinho, calculado no servidor: `OFFLINE · CONECTANDO · PRONTO · TESTANDO · ATENÇÃO · FALHA · EMERGÊNCIA`.

## 6. Dados
- Telemetria e aceite separados: o aceite é uma entidade própria (item, estado, mensagem, início, fim), salva no banco por carrinho e por dia/evento.
- Comandos pelo WebSocket do operador, como os demais (ver seção 8), não REST novo.
- Componentes reaproveitáveis: Panel, StatusBadge, Metric, ProgressBar, TestButton, AcceptanceRow, LogRow.

## 7. Decisões do Rodrigo (10/10/2026)
1. **Verde só para status:** `--ok #3FAE6A` (verde técnico, dessaturado) em APROVADO, ONLINE e indicadores positivos; texto verde sobre fundo claro usa `--ok-ink`. Nunca em botão comum nem na identidade. Laranja = ação / teste em andamento; vinho `--danger` = falha / emergência; cinza = neutro.
2. **Aceite obrigatório por evento:** configurou a unidade → abriu o evento → aceite antes de liberar o carrinho. Vale durante o evento até algo invalidar: perda prolongada de comunicação (5 s), troca de volante, reinício da placa, troca de carrinho, parada de emergência / intervenção técnica, ou um novo evento. O operador pode refazer quando quiser. Sem evento (treino) o aceite não bloqueia.
3. **Câmera crítica:** imagem chegando com FPS mínimo. Áudio continua auxiliar.
4. **Sem seletor de unidade** na tela individual: a escolha é na grade; a barra inferior só identifica "UNIDADE 03 · VERMELHO".
5. **Nome:** na tela "03 VERMELHO"; ID técnico interno `RC-03` (`unitId` no servidor).

## 8. Situação (10/10/2026) — implementado, testado só em simulação
- Servidor: `backend/acceptance.py` (aceite puro e testável), ligado à frota (`fleet.py`): estado único da unidade, métricas da placa, log por carrinho, PARADA DE EMERGÊNCIA com trava até RESET, bloqueio com evento aberto. Cada aceite completo é salvo na tabela `acceptances` (carrinho, placa, evento, resultado, itens).
- Comandos do operador (WebSocket): `acceptanceStart {slot, items?}`, `acceptanceArea`, `acceptanceReport {item, ...}`, `acceptanceCancel`, `emergency`, `emergencyReset`.
- Tela: `frontend/src/components/TechnicalCentral.tsx` + `frontend/src/technical.css`, aberta pelo INDIVIDUAL / ANALISAR da grade, **igual em CARRINHO REAL e em SIMULAÇÃO**. O veredito do topo (`frontend/src/unitVerdict.ts`) é o mesmo do cartão da grade.
- Arena SIMULAÇÃO (servidor): os pilotos virtuais giram o volante e pisam nos pedais quando pedido; a câmera passa como "câmera simulada" (só lá). Área livre e "você ouviu?" continuam com o operador.
- Atuadores: quatro blocos K1–K4 (função, estado confirmado pela placa, último teste, TESTAR; K1/K2 pedem ÁREA LIVRE), TESTE SEQUENCIAL e AUTOTESTE RÁPIDO.
- Limites conhecidos: faixa do volante em graus usa a aproximação atual (±45°) até configurar o modelo do volante; latência e codec do vídeo não são medidos (N/D); o aceite fica na memória e é refeito se o app reiniciar (o histórico fica no banco).
