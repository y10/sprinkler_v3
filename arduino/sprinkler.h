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
    logLevel_t lvl = Device.logLevel(level);
    Console.logLevel(lvl);
  }

  void logLevel(uint8_t level) {
    Device.logLevel(level);
    Console.logLevel((logLevel_t)level);
  }

  uint8_t logLevelNumber() {
    return Device.logLevelNumber();
  }

  bool water(String source) {
    return Device.source() != Device.source(source.c_str());
  }

  String toJSON() {
    return (String) "{ \"logLevel\": " + (String)logLevelNumber() +
      ", \"alexaEnabled\": " + (Device.alexaEnabled() ? "true" : "false") +
      ", \"mqttHost\": \"" + Device.mqttHost() +
      "\", \"mqttPort\": " + Device.mqttPort() +
      ", \"mqttUser\": \"" + Device.mqttUser() +
      "\", \"mqttEnabled\": " + (Device.mqttEnabled() ? "true" : "false") +
      ", \"name\": \"" + Device.dispname() +
      "\", \"ssid\": \"" + wifissid() +
      "\", \"host\": \"" + Device.hostname() +
      "\", \"zones\": " + Settings.toJSON() +
      ", \"sequence\": " + sequenceToJSON() +
      ", \"source\": \"" + Device.source() +
      "\", \"enabled\": " + isEnabled() + " }";
  }

  String sequenceToJSON();

  bool fromJSON(JsonObject json);

  bool isWatering() { return Timers.isWatering(); }

  void initCommandQueue() {
    sprinklerCommandQueue = xQueueCreate(16, sizeof(ZoneCommand));
    sprinklerStateMutex = xSemaphoreCreateMutex();
  }

  void processCommands();

  // Thread-safe state reads (for async_tcp context)
  String safeStateJSON() {
    xSemaphoreTake(sprinklerStateMutex, portMAX_DELAY);
    String result = Timers.toJSON();
    xSemaphoreGive(sprinklerStateMutex);
    return result;
  }

  String safeStateJSON(unsigned int zone) {
    xSemaphoreTake(sprinklerStateMutex, portMAX_DELAY);
    String result = Timers.toJSON(zone);
    xSemaphoreGive(sprinklerStateMutex);
    return result;
  }

  bool safeIsWatering() {
    xSemaphoreTake(sprinklerStateMutex, portMAX_DELAY);
    bool result = Timers.isWatering();
    xSemaphoreGive(sprinklerStateMutex);
    return result;
  }

  bool safeIsWatering(unsigned int zone) {
    xSemaphoreTake(sprinklerStateMutex, portMAX_DELAY);
    bool result = Timers.isWatering(zone);
    xSemaphoreGive(sprinklerStateMutex);
    return result;
  }

  // Async API — enqueues commands for thread-safe execution from any context
  void requestStart(unsigned int zone, unsigned int duration);
  void requestStop(unsigned int zone);
  void requestStop();
  void requestPause(unsigned int zone);
  void requestResume(unsigned int zone);
  void requestEnable();
  void requestDisable();

  // Chain API — HTTP-context enqueuers: stage payload + enqueue, never mutate Sequence directly
  void requestChainStart(const uint8_t* order, uint8_t orderCount,
                         const uint8_t* durations, uint8_t gap);
  void requestChainStop();
  void requestChainUpdate(const uint8_t* order, uint8_t orderCount,
                          const uint8_t* durations);
  String chainStateJSON();  // takes the mutex — safe to call from async_tcp context

  // Sync API — direct execution (called by processCommands under mutex)
  void start(unsigned int zone, unsigned int duration);
  void stop(unsigned int zone, bool fromChain = false);
  void stop();
  void pause(unsigned int zone);
  void resume(unsigned int zone);

  // Chain sync workers — called by processCommands under the mutex
  void chainStart(uint8_t slot);
  void chainUpdate(uint8_t slot);
  void chainAdvance(uint8_t zone, uint8_t epoch);
  void chainStartNext(uint8_t epoch);

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

  // Sequence detection helpers
  bool isInSequenceWindow();
  bool isZoneInSequence(uint8_t zone);
  uint8_t getZoneSequenceIndex(uint8_t zone);
  void startSequenceSession(uint8_t zoneIndex);

 private:
  std::map<const char *, std::vector<OnEvent>> onEventHandlers;

  String chainStateJSONLocked();  // assumes caller holds sprinklerStateMutex

  void enqueue(ZoneAction action, uint8_t zone = 0, uint8_t duration = 0) {
    ZoneCommand cmd = { action, zone, duration };
    xQueueSend(sprinklerCommandQueue, &cmd, 0);
  }
};

extern SprinklerControl Sprinkler;

void setupCommands();
void handleCommands();

#endif