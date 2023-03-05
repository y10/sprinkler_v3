#include <WsConsole.h>
#include <fauxmoESP.h>

#include "sprinkler.h"

static WsConsole alexa_console("alxa");

std::unique_ptr<fauxmoESP> fauxmo;

void handleAlexa() {
  if (WiFi.getMode() & WIFI_STA) {
    fauxmo->handle();
  }
}

void setupAlexa() {
  if (WiFi.getMode() & WIFI_STA) {
    fauxmo.reset(new fauxmoESP());

    // Setup Alexa devices
    if (Sprinkler.dispname().length() > 0) {
      fauxmo->addDevice(Sprinkler.dispname().c_str());
      alexa_console.println("Started.");
    }

    fauxmo->onSet([&](unsigned char device_id, const char *device_name, bool state, unsigned char value) {
      alexa_console.printf("Set Device #%d (%s) state: %s\n", device_id, device_name, state ? "ON" : "OFF");
      // TODO: pass zone
      // state ? Sprinkler.start() : Sprinkler.stop();
    });

    fauxmo->onGet([&](unsigned char device_id, const char *device_name, bool &state, unsigned char &value) {
      state = Sprinkler.isWatering();
      alexa_console.printf("Get Device #%d (%s) state: %s\n", device_id, device_name, state ? "ON" : "OFF");
    });
  }
}
