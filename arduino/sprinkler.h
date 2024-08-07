#ifndef SPRINKLER_H
#define SPRINKLER_H

#include <ArduinoJson.h>
#include <functional>
#include <map>
#include <vector>

#include "sprinkler-pinout.h"
#include "sprinkler-device.h"
#include "sprinkler-settings.h"
#include "sprinkler-state.h"

class SprinklerControl {

 protected:
  String SSID = "";
  String SKEY = "";

 public:
  SprinklerSettings Settings;
  SprinklerDevice Device;
  SprinklerState Timers;
  bool connectedWifi = false;

  SprinklerControl()
   : Settings([&](SprinklerZone *zone, SprinklerTimer *timer) { scheduled(zone->index(), timer->duration()); }) {
  }

  const char * builtDateString() const { return Device.builtDateString(); }
  const time_t builtDate() const { return Device.builtDate(); }

  const String safename() { return Device.safename(); }

  const String dispname() const { return Device.dispname(); }
  const String dispname(const char *name) { return Device.dispname(name); }

  const String hostname() const { return Device.hostname(); }
  const String hostname(const char *name) { return Device.hostname(name); }

  const String wifissid(bool persisted = false);
  const String wifipass(bool persisted = false);

  void logLevel(const char *level) {
    Device.logLevel(level);
  }

  bool water(String source) {
    return Device.source() != Device.source(source.c_str());
  }

  String toJSON() {
    return (String) "{ \"logLevel\": \"" + (String)Device.logLevel() + "\", \"name\": \"" + Device.dispname() + "\", \"ssid\": \"" + wifissid() + "\", \"host\": \"" + Device.hostname() + "\",  \"zones\": " + Settings.toJSON() + ",  \"source\": \"" + Device.source() + "\",  \"enabled\": " + isEnabled() + " }";
  }

  bool fromJSON(JsonObject json);

  bool isWatering() { return Timers.isWatering(); }

  void start(unsigned int zone, unsigned int duration);
  void stop(unsigned int zone);
  void stop();
  void pause(unsigned int zone);
  void resume(unsigned int zone);

  bool isEnabled();
  void enable();
  void disable();
  bool isAttached();
  void attach();
  void detach();
  void load();
  void save();
  void reset();
  void restart();

  typedef std::function<void(const char *)> OnEvent;
  void on(const char *eventType, OnEvent event);

 protected:
  void fireEvent(const char *eventType) { fireEvent(eventType, ""); }
  void fireEvent(const char *eventType, const String evenDescription) { fireEvent(eventType, evenDescription.c_str()); }
  void fireEvent(const char *eventType, const char *evenDescription);

  void scheduled(unsigned int zone, unsigned int duration);

 private:
  std::map<const char *, std::vector<OnEvent>> onEventHandlers;
};

extern SprinklerControl Sprinkler;
#endif