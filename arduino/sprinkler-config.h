#ifndef SPRINKLER_CONFIG_H
#define SPRINKLER_CONFIG_H

#include "html/settings.json.h"

struct SprinklerTimerConfig
{
  bool defined;
  unsigned int h;
  unsigned int m;
  unsigned int d;

  SprinklerTimerConfig(): defined(false), h(0), m(0), d(0) {}
};

struct SprinklerZoneConfig
{
  bool defined;
  char disp_name[50];
  SprinklerTimerConfig days[8]; // 7 weekdays + 1 for everyday
  SprinklerZoneConfig() : defined(false), disp_name({0}) {}
};

struct SprinklerSequenceConfig
{
  bool enabled;               // Whether sequence is active
  uint8_t order[6];           // Zone indices (1-6), 0-terminated like strings
  uint8_t days;               // Bitmask: bit 0=Sun, 1=Mon, 2=Tue, ... 6=Sat
  uint8_t hour;               // Start hour (0-23)
  uint8_t minute;             // Start minute (0-59)
  uint8_t duration;           // Duration per zone in minutes
  uint8_t gap;                // Gap between zones in minutes

  SprinklerSequenceConfig()
    : enabled(false), order{0}, days(0),
      hour(6), minute(0), duration(15), gap(5) {}

  // Helper to get count (like strlen for null-terminated strings)
  uint8_t orderCount() const {
    for (uint8_t i = 0; i < 6; i++) {
      if (order[i] == 0) return i;
    }
    return 6;
  }
};

struct SprinklerConfig
{
  uint8_t version;
  uint8_t loglevel;
  char full_name[50];
  char host_name[50];
  char disp_name[50];
  char source;
  bool alexa_enabled;
  // MQTT configuration
  char mqtt_host[64];
  uint16_t mqtt_port;
  char mqtt_user[32];
  char mqtt_pass[64];
  bool mqtt_enabled;
  // Sequence
  SprinklerSequenceConfig sequence;
  // Zones
  SprinklerZoneConfig zones[SKETCH_MAX_ZONES];
  SprinklerConfig(): version(0), full_name({0}), host_name({0}), disp_name({0}),
    source('P'), alexa_enabled(true), mqtt_host({0}), mqtt_port(1883),
    mqtt_user({0}), mqtt_pass({0}), mqtt_enabled(false) {}
};

#endif