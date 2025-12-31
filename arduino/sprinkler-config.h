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
  // Zones
  SprinklerZoneConfig zones[SKETCH_MAX_ZONES];
  SprinklerConfig(): version(0), full_name({0}), host_name({0}), disp_name({0}),
    source('P'), alexa_enabled(true), mqtt_host({0}), mqtt_port(1883),
    mqtt_user({0}), mqtt_pass({0}), mqtt_enabled(false) {}
};

#endif