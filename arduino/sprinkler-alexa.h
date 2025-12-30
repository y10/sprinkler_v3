#ifndef SPRINKLER_ALEXA_H
#define SPRINKLER_ALEXA_H

#include <WsConsole.h>
#include <fauxmoESP.h>

#include "sprinkler.h"
#include "html/settings.json.h"

static WsConsole alexa_console("alxa");

// FauxmoESP instance (unique_ptr for lazy initialization)
std::unique_ptr<fauxmoESP> fauxmo;

// Device ID to Zone ID mapping
// device_id 0 = system device (enable/disable), zone_id = 0
// device_id 1+ = zone devices, zone_id = 1-6
static unsigned int deviceToZone[SKETCH_MAX_ZONES + 1];  // +1 for system device
static unsigned int registeredDevices = 0;

#define ALEXA_SYSTEM_DEVICE 0

// Forward declaration for HTTP integration
bool processAlexaRequest(AsyncClient *client, bool isGet, String url, String body);

void handleAlexa() {
  if (fauxmo && (WiFi.getMode() & WIFI_STA)) {
    fauxmo->handle();
  }
}

void setupAlexa() {
  if (!(WiFi.getMode() & WIFI_STA)) {
    alexa_console.println("Skipped (not in STA mode)");
    return;
  }

  fauxmo.reset(new fauxmoESP());

  // Configure for external server mode (share port 80 with AsyncWebServer)
  // CRITICAL: This MUST be done before enable()
  fauxmo->createServer(false);
  fauxmo->setPort(80);

  // Get system display name for device naming
  String systemName = Sprinkler.dispname();
  if (systemName.length() == 0) {
    systemName = "Sprinkler";
  }

  // Create plural form for "all zones" device (e.g., "Sprinkler" -> "Sprinklers")
  String pluralName = systemName;
  char lastChar = systemName.charAt(systemName.length() - 1);
  if (lastChar == 's' || lastChar == 'x' || lastChar == 'z') {
    pluralName += "es";
  } else {
    pluralName += "s";
  }

  registeredDevices = 0;

  // Register ALL ZONES device first (device_id 0)
  // "Turn off Sprinklers" = stop all zones
  {
    unsigned char deviceId = fauxmo->addDevice(pluralName.c_str());
    deviceToZone[deviceId] = ALEXA_SYSTEM_DEVICE;
    registeredDevices++;
    alexa_console.printf("Registered: %s (device=%d, ALL ZONES)\n", pluralName.c_str(), deviceId);
  }

  // Register each configured zone as an Alexa device (device_id 1+)
  Sprinkler.Settings.forEachZone([&systemName](unsigned int zoneId, SprinklerZone* zone) {
    if (zone->name().length() > 0 && registeredDevices < (SKETCH_MAX_ZONES + 1)) {
      // Format: "<system_name> at <zone_name>"
      String deviceName = systemName + " at " + zone->name();

      unsigned char deviceId = fauxmo->addDevice(deviceName.c_str());
      deviceToZone[deviceId] = zoneId;
      registeredDevices++;

      alexa_console.printf("Registered: %s (device=%d, zone=%d)\n",
                           deviceName.c_str(), deviceId, zoneId);
    }
  });

  // Handle Alexa "turn on/off" commands
  fauxmo->onSet([](unsigned char device_id, const char *device_name, bool state, unsigned char value) {
    if (device_id >= registeredDevices) {
      alexa_console.printf("Invalid device_id: %d\n", device_id);
      return;
    }

    unsigned int zoneId = deviceToZone[device_id];

    if (zoneId == ALEXA_SYSTEM_DEVICE) {
      // All zones device: start all / stop all
      alexa_console.printf("Set: %s (ALL) -> %s\n", device_name, state ? "ON" : "OFF");
      if (state) {
        // Turn on all configured zones
        Sprinkler.Settings.forEachZone([](unsigned int zId, SprinklerZone* zone) {
          if (zone->name().length() > 0) {
            Sprinkler.start(zId, SKETCH_TIMER_DEFAULT_LIMIT);
          }
        });
      } else {
        // Stop all zones
        Sprinkler.stop();
      }
    } else {
      // Zone device: start/stop watering
      alexa_console.printf("Set: %s (zone=%d) -> %s\n", device_name, zoneId, state ? "ON" : "OFF");
      if (state) {
        Sprinkler.start(zoneId, SKETCH_TIMER_DEFAULT_LIMIT);
      } else {
        Sprinkler.stop(zoneId);
      }
    }
  });

  // Handle Alexa "is X on?" queries
  fauxmo->onGet([](unsigned char device_id, const char *device_name, bool &state, unsigned char &value) {
    if (device_id >= registeredDevices) {
      state = false;
      value = 0;
      return;
    }

    unsigned int zoneId = deviceToZone[device_id];

    if (zoneId == ALEXA_SYSTEM_DEVICE) {
      // All zones device: report if any zone is watering
      state = Sprinkler.isWatering();
      value = state ? 255 : 0;
      alexa_console.printf("Get: %s (ALL) -> %s\n", device_name, state ? "ON" : "OFF");
    } else {
      // Zone device: report if zone is watering
      state = Sprinkler.Timers.isWatering(zoneId);
      value = state ? 255 : 0;
      alexa_console.printf("Get: %s (zone=%d) -> %s\n", device_name, zoneId, state ? "ON" : "OFF");
    }
  });

  // Enable FauxmoESP (starts UDP listener for SSDP discovery)
  fauxmo->enable(true);

  alexa_console.printf("Started (%d devices: 1 all-zones + %d zones)\n",
                       registeredDevices, registeredDevices - 1);
}

// Process Alexa HTTP requests (called from sprinkler-http.h)
bool processAlexaRequest(AsyncClient *client, bool isGet, String url, String body) {
  if (fauxmo) {
    return fauxmo->process(client, isGet, url, body);
  }
  return false;
}

#endif
