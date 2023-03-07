#ifndef SPRINKLER_DEVICE_H
#define SPRINKLER_DEVICE_H

#include <EEPROM.h>
#include <WsConsole.h>

#include "includes/files.h"
#include "sprinkler-config.h"

#define EEPROM_SIZE 4096

class SprinklerDevice {
 protected:
  uint8_t relays;

 private:
  uint8_t loglevel;

  String host_name;
  String disp_name;
  String full_name;

  uint8_t pins[8];

  uint8_t version;

 public:
  SprinklerDevice(uint8_t RL1, uint8_t RL2, uint8_t RL3, uint8_t RL4, uint8_t RL5, uint8_t RL6, uint8_t RL7, uint8_t RL8);

  const char *builtDateString() const { return __DATE__ " " __TIME__ " GMT"; }

  const time_t builtDate() const {
    struct tm t;
    if (strptime(builtDateString(), "%b %d %Y %H:%M:%S GMT", &t)) {
      return mktime(&t);
    }
    return 0;
  }

  const String safename();

  const String dispname() const { return disp_name; }

  const String dispname(const char *name);

  const String hostname() const { return host_name; }

  const String hostname(const char *name);

  const String fullname() const { return full_name; }

  logLevel_t logLevel(const char *level);

  const char *logLevel();

  SprinklerConfig load();

  void save(SprinklerConfig cfg);

  void clear();

  uint8_t ICACHE_RAM_ATTR turnOn(uint8_t relay = 0);

  uint8_t ICACHE_RAM_ATTR turnOff(uint8_t relay = 0);

  uint8_t ICACHE_RAM_ATTR toggle(uint8_t relay = 0);

  void blink(float seconds);

  void reset();

  void restart();

  String toJSON() {
    return (String) "{" +
           "\r\n  \"disp_name\": \"" + dispname() + "\"" +
           "\r\n ,\"host_name\": \"" + hostname() + "\"" +
           "\r\n}";
  }
};

#endif