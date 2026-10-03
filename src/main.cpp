#include <Arduino.h>

const int pinos[] = {25, 26, 27, 14};
const int LIGADO = LOW;
const int DESLIGADO = HIGH;
uint8_t ativos = 0;
unsigned long prazo = 0;

void aplicar(uint8_t mascara) {
  // Nunca permitir comandos opostos no mesmo eixo.
  if ((mascara & 3) == 3) mascara &= ~3;
  if ((mascara & 12) == 12) mascara &= ~12;
  // Desligar saidas removidas antes de ligar novas; preservar as mantidas.
  for (int i = 0; i < 4; ++i)
    if (!(mascara & (1 << i))) digitalWrite(pinos[i], DESLIGADO);
  for (int i = 0; i < 4; ++i)
    if (mascara & (1 << i)) digitalWrite(pinos[i], LIGADO);
  ativos = mascara;
}

void confirmar() {
  Serial.print("ESTADO ");
  Serial.println(ativos);
}

void setup() {
  Serial.begin(115200);
  for (int pino : pinos) {
    digitalWrite(pino, DESLIGADO);
    pinMode(pino, OUTPUT);
  }
  Serial.println("Pronto CONTROLE v5");
}

void loop() {
  if (ativos && (long)(millis() - prazo) >= 0) {
    aplicar(0);
    confirmar();
  }
  if (!Serial.available()) return;
  char comando = Serial.read();
  if (comando == '?') Serial.println("Pronto CONTROLE v5");
  if (comando == 'S') {
    aplicar(0);
    confirmar();
  }
  // a..p transporta o estado completo dos quatro reles (bits 0..3).
  if (comando >= 'a' && comando <= 'p') {
    aplicar(comando - 'a');
    prazo = millis() + 600;
    confirmar();
  }
  // Cliques individuais no painel continuam gerando pulsos de 500 ms.
  if (comando >= '1' && comando <= '4' && !ativos) {
    aplicar(1 << (comando - '1'));
    prazo = millis() + 500;
    Serial.print("Testando rele ");
    Serial.println(comando);
    confirmar();
  }
}
