# RC Racing — roteiro (passo a passo)

O que já foi feito, o que falta e **qual é a próxima ação**. A especificação do que existe está em [ESPECIFICACAO.md](ESPECIFICACAO.md).

Atualizado em 10/10/2026. Legenda: ✅ pronto · 🧪 pronto, só testado em simulação · ⏳ a fazer · 🔒 depende de hardware ou decisão

## ▶ Próxima ação

**Etapa 1 — validar no hardware.** O código está no GitHub (`main`, 11/10/2026): pronto para o deploy e o teste em rede. Próximo passo: gravar o firmware v6 e rodar o aceite técnico da Central em cada carrinho real.

Depois dela: **etapa 1 (validar no hardware) usando o aceite técnico da Central** como roteiro de teste de cada carrinho. Assim a validação vira um procedimento repetível em vez de um teste solto.

## Feito

| # | Entrega | Situação |
|---|---|---|
| — | v1.1: 1 carrinho, instalador com driver, diagnóstico, pen drive | ✅ validado em 2 PCs |
| — | Ranking SQLite, contra o relógio, pânico no X, volumes, autoteste, sons, limitador de giro | ✅ (X, Y e autoteste ainda não conferidos no hardware) |
| — | Visão Piloto com câmera C920 | ✅ testada com a câmera real |
| — | Frota de vários carrinhos, Visão Corrida, telão, tablets, plug & play (firmware v6) | 🧪 |
| — | Nova identidade visual (tokens em `theme.css`, 16 cores, vinho só para perigo) | 🧪 |
| — | Visão Mecânico em grade 1/4/8/16, individual para incidente | 🧪 |
| — | Bateria por tempo (30 min, avisos 20/10/5%, bloqueio em 5%) | 🧪 |
| — | Adicionar controle vaga por vaga (assistente de 4 passos) | 🧪 |
| A | Operador não dirige pelo painel | 🧪 |
| B | Cada volta salva na hora + aviso NOVO MELHOR TEMPO / RECORDE (som só no recorde) | 🧪 |
| C | Abrir/Encerrar Evento, sessões anônimas, TOP N provisório com corte e avisos | 🧪 |
| — | Número de cockpits como parâmetro (`cockpits`, até 16), "PC Central" | 🧪 |
| 2A | Central Técnica: aceite técnico (7 itens), bloqueio com evento aberto, emergência com RESET, métricas reais da placa, log | 🧪 |
| 2B | SIMULAÇÃO = as mesmas telas do real sobre uma arena simulada no servidor (16 carrinhos, banco próprio, pronta para teste); modo real sem nada simulado; cartão da grade com veredito LIBERADO / NÃO PODE RODAR + motivo, igual à Central | 🧪 |

## A fazer, em ordem

### Etapa 0 — Proteger ✅
- [x] Commits em blocos na `main` (11/10/2026), sem banco de dados; `public/brieffing` e `public/MD` fora do Git.
- [x] Push para o GitHub (11/10/2026).

### Etapa 1 — Validar no hardware 🔒 (precisa das placas, volantes e carrinho suspenso)
- [ ] Gravar o firmware v6 em cada placa (confirmar `Pronto CONTROLE v6 ID ...`).
- [ ] Rodar o **aceite técnico da Central** em cada carrinho real (área livre de verdade, câmera C920 medindo FPS, som no alto-falante do evento); conferir tempos de confirmação e da parada de emergência.
- [ ] 1 carrinho: largada A / acelerador, B, X (pânico), Y (volta), autoteste, bateria bloqueando em 5%.
- [ ] Assistente com volante real: A + B por 2 s, varredura de volante e pedais, USAR ESTA PLACA.
- [ ] 2 → 4 carrinhos: plug & play, reserva, LARGAR TODOS, PARAR TODOS, tablets no Wi-Fi, telão.
- [ ] Evento real: abrir, voltas salvas, recorde com som, TOP 8, encerrar.
- [ ] Desempenho do PC Central com a grade 16 e o telão abertos.
- [ ] Gerar instalador/pen drive novo e testar no 2º PC.

### Etapa 2A — Central Técnica (nova Visão Individual) 🧪 — especificação em [CENTRAL_TECNICA.md](CENTRAL_TECNICA.md)
- [x] As 5 decisões respondidas (verde só para status, aceite por evento, câmera crítica, sem seletor, "03 VERMELHO" + ID `RC-03`).
- [x] Servidor: estado único do carrinho, métricas reais da placa (tempo de confirmação, confirmações atrasadas, reconexões, reinícios, firmware/ID) e log por carrinho.
- [x] Servidor: aceite técnico (7 itens, 4 estados), salvo no banco; falha crítica bloqueia o carrinho com evento aberto; invalidações automáticas.
- [x] Teste sequencial dos relés com CONFIRMAR ÁREA LIVRE; parada de emergência verificando `ESTADO 0` no tempo; PARADA DE EMERGÊNCIA com RESET.
- [x] Tela com abas, sem o mapa, barra inferior fixa com emergência; selo do aceite nos cartões da grade.
- [x] Valores não medidos como N/D.
- [x] Testes: 11 unittest do aceite, 1 Playwright da Central (73 / 8 / 25).
- [ ] Configurar a faixa do volante em graus (hoje ±45° aproximado) quando o modelo do volante for definido.
- [ ] Aba CONFIGURAÇÕES editável para a instalação (cockpits, TOP N).

### Etapa 2 — Acabamento do que existe ⏳ (pode andar junto com a etapa 1)
- [x] Apagar os arquivos da antiga simulação no navegador (`raceRules.ts`, `raceRules.test.ts`, `simFleet.ts`, `useKeyboardDrive.ts`).
- [x] Separar o projeto em `frontend/` (painel) e `backend/` (servidor), cada um com suas dependências e build.
- [ ] Limpar o CSS dos widgets da visão antiga (velocímetro, mapa, cronômetro) em `styles.css` / `offroad.css`.
- [ ] Na simulação, poder testar o assistente + ADICIONAR CONTROLE (hoje ela começa com as 16 vagas configuradas).
- [ ] Tirar do servidor o que sobrou de nome de piloto (`slot.driver`, comando `driver`, `clean_driver`).
- [ ] Visão Piloto: relé "ligado" ainda usa a cor do carrinho (contra a regra; trocar por estado).
- [ ] Limpar cores fixas em `styles.css`, `offroad.css` e `pilot.css` (passar para os tokens).
- [ ] Revisar a identidade da Visão Piloto e do Telão no fundo escuro.
- [ ] Remover/desconfigurar uma vaga (hoje só dá para adicionar).
- [ ] Tela de "Configuração da instalação" (cockpits, top N) em vez de banco/linha de comando — pode virar a aba CONFIGURAÇÕES da Central Técnica.
- [ ] Recorde do evento visível também na Central Técnica.
- [ ] Os cartões da grade ainda têm TESTAR (autoteste curto) sem pedir área livre; decidir se pede também.

### Etapa 3 — Regras do contrato ⏳
- [ ] Confirmação segurando A por 2 s.
- [ ] Limite de 6 min por volta; corrida de 5 voltas; resultado em exibição por 2 min 30 s.

### Etapa 4 — Sensores na pista 🔒 (hardware novo)
- [ ] Zonas de chegada, checkpoint e parada, com identificador em cada carro (hoje a volta é marcada à mão, pelo Y).

### Etapa 5 — Campeonato ⏳
- [ ] **D** Cadastro por QR pelo **painel remoto na internet** (consentimento LGPD; menor precisa do responsável). Junta sessões da mesma pessoa.
- [ ] **E** Congelar o evento → TOP 8 oficial + suplentes, notificações.
- [ ] **F** Final da cidade e ranking nacional.

### Etapa 6 — Relatório e painel remoto ⏳
- [ ] O evento roda offline; ao achar internet, envia o relatório a um painel à parte (Vercel / Railway / PostgreSQL). Nenhuma ação remota move um carro. (Base da fase D.)

### Etapa 7 — Menu técnico ⏳ (a Central Técnica da etapa 2A é a base)
- [ ] Saúde de cada posto, leitura do registro, intercorrências, lista de bugs, troca guiada de peças.

### Etapa 8 — Expansão e vídeo 🔒
- [ ] Modo D (DirectInput/HID) para mais de 4 volantes; testar com o volante real.
- [ ] Vídeo da câmera nos tablets pela rede local, com atraso baixo.
- [ ] Aceleração proporcional (exige mudança no hardware; hoje o relé só liga e desliga).

## Como atualizar este roteiro
Ao terminar uma entrega: marque o item, ajuste a tabela "Feito" (✅ só depois do teste no hardware; antes disso 🧪) e reescreva a **Próxima ação**.
