#include "sprinkler.h"

#include <WiFi.h>
#include <WsConsole.h>
#include <esp_wifi.h>

WsConsole console("unit");

const String SprinklerControl::wifissid(bool persisted) {
  if (persisted) {
    if (WiFiGenericClass::getMode() & WIFI_MODE_STA) {
      wifi_config_t conf;
      esp_wifi_get_config(WIFI_IF_STA, &conf);
      return String(reinterpret_cast<const char *>(conf.sta.ssid));
    }
    return String();
  }
  return SSID;
}

const String SprinklerControl::wifipass(bool persisted) {
  if (persisted) {
    if (WiFiGenericClass::getMode() & WIFI_MODE_STA) {
      wifi_config_t conf;
      esp_wifi_get_config(WIFI_IF_STA, &conf);
      return String(reinterpret_cast<char *>(conf.sta.password));
    }
    return String();
  }
  return SKEY;
}

void SprinklerControl::fireEvent(const char *eventType, const char *evenDescription) {
  for (auto &event : onEventHandlers[eventType]) {
    event(evenDescription);
  }
}

void SprinklerControl::on(const char *eventType, OnEvent event) {
  onEventHandlers[eventType].push_back(event);
}

void SprinklerControl::start(unsigned int zone, unsigned int duration = 0) {
  console.println("Starting timer " + (String)zone);

  Device.turnOn(zone);  // zone first
  Device.turnOn();      // engine last

  Timers.start(zone, duration, [this, zone] { stop(zone); });
  fireEvent("state", Timers.toJSON(zone));
}

void SprinklerControl::stop(unsigned int zone) {
  console.println("Stopping timer " + (String)zone);
  if (Timers.isWatering(zone)) {
    if (Timers.count() == 1) {
      Device.turnOff();
    }
    Device.turnOff(zone);  // zone last
    Timers.stop(zone);     // detach and remove timer
    fireEvent("state", Timers.toJSON(zone));
  }
}

void SprinklerControl::pause(unsigned int zone) {
  console.println("Pausing timer " + (String)zone);
  if (Timers.isWatering(zone)) {
    if (Timers.count() == 1) {
      Device.turnOff();
    }
    Timers.pause(zone);
    Device.turnOff(zone);
    fireEvent("state", Timers.toJSON(zone));
  }
}

void SprinklerControl::resume(unsigned int zone) {
  console.println("Resuming timer " + (String)zone);
  if (Timers.isPaused(zone)) {
    Timers.resume(zone);
    Device.turnOn(zone);  // zone first
    Device.turnOn();      // engine last
    fireEvent("state", Timers.toJSON(zone));
  }
}

bool SprinklerControl::fromJSON(JsonObject json) {
  if (json.containsKey("name")) {
    Device.dispname(json["name"].as<char *>());
  }

  if (json.containsKey("chip")) {
    Device.hostname(json["chip"].as<char *>());
  }

  if (json.containsKey("zones")) {
    Settings.fromJSON(json["zones"].as<JsonObject>());
  }

  save();
  attach();
  return true;
}

void SprinklerControl::attach() {
  Settings.attach();
}

void SprinklerControl::load() {
  SprinklerConfig cfg = Device.load();
  Console.logLevel((logLevel_t)cfg.loglevel);
  Settings.fromConfig(cfg);
}

void SprinklerControl::save() {
  SprinklerConfig tmp = Settings.toConfig();
  Device.save(tmp);
  console.println(toJSON());
}

void SprinklerControl::reset() {
  console.warn("Factory reset requested.");
  Device.reset();
}

void SprinklerControl::restart() {
  console.warn("Restart requested.");
  Device.restart();
}

SprinklerControl Sprinkler = SprinklerControl();