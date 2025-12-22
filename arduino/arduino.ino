#include <Ticker.h>
#include <WsConsole.h>

#include "sprinkler-alexa.h"
#include "sprinkler-http.h"
#include "sprinkler-ota.h"
#include "sprinkler-setup.h"
#include "sprinkler-time.h"
#include "sprinkler-wifi.h"
#include "sprinkler.h"

Ticker ticker;

void begin() {
  ticker.attach(0.6, tick);
  Console.begin(115200);
}

void setup() {
  begin();

  setupUnit();
  setupWifi();
  setupDhcp();
  setupTime();
  setupHttp();
  setupOTA();
  setupAlexa();

  end();
}

void loop() {
  handleWifi();
  handleOTA();
  handleAlexa();
  handleTicks();
}

void tick() {
  int state = digitalRead(LED_PIN);
  digitalWrite(LED_PIN, !state);
}

void end() {
  // Boot safety: ensure all zones are OFF regardless of prior state
  Sprinkler.stop();
  Console.println("unit", "Boot safety: all zones OFF");

  digitalWrite(LED_PIN, LOW);
  ticker.detach();
  Console.println("unit", "Started.");
}