#include <Arduino.h>

const int pinos[] = {25, 26, 27, 14};

// Teste para modulo acionado em nivel baixo.
const int LIGADO = LOW;
const int DESLIGADO = HIGH;
int ativo = -1;
bool continuo = false;
unsigned long prazo = 0;

void desligar() {
  for (int pino : pinos) digitalWrite(pino, DESLIGADO);
  ativo = -1;
  continuo = false;
}

void setup() {
  Serial.begin(115200);

  for (int pino : pinos) {
    digitalWrite(pino, DESLIGADO);
    pinMode(pino, OUTPUT);
  }

  Serial.println("Pronto CONTROLE v4");
}

void loop() {
  if (ativo >= 0 && (long)(millis() - prazo) >= 0) {
    desligar();
    Serial.println("DESLIGADO");
  }
  if (!Serial.available()) return;

  char comando = Serial.read();

  if (comando == '?') Serial.println("Pronto CONTROLE v4");
  if (comando == 'S') {
    desligar();
    Serial.println("DESLIGADO");
  }
  if (comando == 'H' || comando == 'J' || comando == 'K' || comando == 'L') {
    int indice = comando == 'H' ? 0 : comando == 'J' ? 1 : comando == 'K' ? 2 : 3;
    if (!continuo || ativo != indice) {
      desligar();
      ativo = indice;
      continuo = true;
      digitalWrite(pinos[indice], LIGADO);
    }
    prazo = millis() + 600;
    Serial.print("K");
    Serial.print(indice + 1);
    Serial.println(" LIGADO");
  }

  if (comando >= '1' && comando <= '4') {
    if (ativo >= 0) return;
    int indice = comando - '1';

    Serial.print("Testando rele ");
    Serial.println(indice + 1);

    digitalWrite(pinos[indice], LIGADO);
    ativo = indice;
    prazo = millis() + 500;
  }
}
