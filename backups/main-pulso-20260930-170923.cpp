#include <Arduino.h>

const int pinos[] = {25, 26, 27, 14};

// Teste para modulo acionado em nivel baixo.
const int LIGADO = LOW;
const int DESLIGADO = HIGH;

void setup() {
  Serial.begin(115200);

  for (int pino : pinos) {
    digitalWrite(pino, DESLIGADO);
    pinMode(pino, OUTPUT);
  }

  Serial.println("Pronto. Envie 1, 2, 3 ou 4 para testar.");
}

void loop() {
  if (!Serial.available()) return;

  char comando = Serial.read();

  if (comando >= '1' && comando <= '4') {
    int indice = comando - '1';

    Serial.print("Testando rele ");
    Serial.println(indice + 1);

    digitalWrite(pinos[indice], LIGADO);
    delay(500);
    digitalWrite(pinos[indice], DESLIGADO);
  }
}
