#include "sprinkler-device.h"

#include <WsConsole.h>

#ifdef ESP8266
#define getChipId() ESP.getChipId() 
#elif defined(ESP32)
#define getChipId() (uint32_t)ESP.getEfuseMac()
#endif

WsConsole unitLog("unit");

SprinklerDevice::SprinklerDevice(uint8_t RL1, uint8_t RL2, uint8_t RL3, uint8_t RL4, uint8_t RL5, uint8_t RL6, uint8_t RL7, uint8_t RL8)
    : pins({RL1, RL2, RL3, RL4, RL5, RL6, RL7, RL8}) {
  disp_name = "Sprinkler";
  host_name = "sprinkler-" + String(getChipId(), HEX);
  full_name = "sprinkler-v" + (String)SKETCH_VERSION_MAJOR + "." + (String)SKETCH_VERSION_MINOR + "." + (String)SKETCH_VERSION_RELEASE + "_" + String(getChipId(), HEX);
  loglevel = logInfo;
  version = 0;
}

const char *SprinklerDevice::logLevel() {
  switch (loglevel) {
    case logError:
      return "error";
    case logWarn:
      return "warn";
    case logInfo:
      return "info";
  }
  return "none";
}

logLevel_t SprinklerDevice::logLevel(const char *level) {
  if (strcmp(level, "none") == 0) {
    loglevel = logNone;
  } else if (strcmp(level, "error") == 0) {
    loglevel = logError;
  } else if (strcmp(level, "warn") == 0) {
    loglevel = logWarn;
  } else if (strcmp(level, "info") == 0) {
    loglevel = logInfo;
  }
  return (logLevel_t)loglevel;
}

const String SprinklerDevice::hostname(const char *name) {
  if (strlen(name) > 0) {
    if (!host_name.equals(name)) {
      host_name = name;
    }
  }

  return host_name;
}

const String SprinklerDevice::dispname(const char *name) {
  if (strlen(name) > 0) {
    if (!disp_name.equals(name)) {
      disp_name = name;
    }
  }

  return disp_name;
}

SprinklerConfig SprinklerDevice::load() {
  EEPROM.begin(EEPROM_SIZE);

  SprinklerConfig cfg;
  EEPROM.get(0, cfg);

  if (full_name.equals(cfg.full_name)) {
    unitLog.print("log level: ");
    unitLog.println(cfg.loglevel);
    loglevel = cfg.loglevel;
    unitLog.print("disp. name: ");
    unitLog.println(cfg.disp_name);
    disp_name = cfg.disp_name;
    unitLog.print("host. name: ");
    unitLog.println(cfg.host_name);
    host_name = cfg.host_name;
    unitLog.print("rev: ");
    unitLog.println(cfg.version);
    version = cfg.version;
  } else {
    memset(&cfg, 0, sizeof(SprinklerConfig));
    strcpy(cfg.disp_name, disp_name.c_str());
    strcpy(cfg.host_name, host_name.c_str());
    strcpy(cfg.full_name, full_name.c_str());
    cfg.loglevel = logInfo;
    cfg.version = version;
    unitLog.println("no config found.");
  }

  EEPROM.end();

  return cfg;
}

void SprinklerDevice::save(SprinklerConfig cfg) {
  strcpy(cfg.disp_name, disp_name.c_str());
  strcpy(cfg.host_name, host_name.c_str());
  strcpy(cfg.full_name, full_name.c_str());
  cfg.loglevel = loglevel;
  cfg.version = version + 1;
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.put(0, cfg);
  EEPROM.end();
  unitLog.println("Saved.");
}

void SprinklerDevice::clear() {
  for (int i = 0; i < EEPROM.length(); i++) {
    EEPROM.write(i, 0);
  }
  EEPROM.commit();
  unitLog.println("Cleared");
}

uint8_t SprinklerDevice::toggle(uint8_t relay) {
  if (relay < sizeof(pins)) {
    uint8_t val = digitalRead(pins[relay]);
    digitalWrite(pins[relay], !val);
    bitWrite(relays, relay, val);

    return !val;
  }

  return 255;
}

uint8_t SprinklerDevice::turnOn(uint8_t relay) {
  if (relay < sizeof(pins) && !bitRead(relays, relay)) {
    digitalWrite(pins[relay], LOW);
    bitWrite(relays, relay, 1);

    return 1;
  }

  return 255;
}

uint8_t SprinklerDevice::turnOff(uint8_t relay) {
  if (relay < sizeof(pins) && bitRead(relays, relay)) {
    digitalWrite(pins[relay], HIGH);
    bitWrite(relays, relay, 0);

    return 0;
  }

  return 255;
}

void SprinklerDevice::reset() {
  unitLog.println("Reseting...");
  for (int i = 0; i < EEPROM.length(); i++) {
    EEPROM.write(i, 0);
  }
  EEPROM.commit();

  WiFi.disconnect(true);
  ESP.restart();
}

void SprinklerDevice::restart() {
  unitLog.println("Restarting...");
  ESP.restart();
}