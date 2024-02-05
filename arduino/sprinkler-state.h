#ifndef SprinklerState_H
#define SprinklerState_H

#include <ArduinoJson.h>
#include <Ticker.h>

#include <functional>
#include <map>

class SprinklerZoneTimer {
 public:
  typedef std::function<void()> OnStopCallback;

  SprinklerZoneTimer(unsigned int zone, unsigned int duration, OnStopCallback onStop)
      : Zone(zone), Duration(duration), StartTime(millis()), PauseTime(0), OnStop(onStop) {
    unsigned long d = (duration ? duration : 5);
    unsigned long ms = d * 1000 * 60;
    timer.once_ms(ms, +[](SprinklerZoneTimer* x) { x->OnStop(); }, this);
  }

  unsigned int Zone;
  unsigned int Duration;
  unsigned long StartTime;
  unsigned long PauseTime;

  ~SprinklerZoneTimer() {
    stop();
  }

  void pause() {
    PauseTime = millis();
    timer.detach();
  }

  void resume() {
    if (!PauseTime)
      return;

    uint32_t d = (uint32_t)Duration * 60 * 1000;
    uint32_t p = PauseTime - StartTime;
    uint32_t ms = d - p;
    timer.once_ms(ms, +[](SprinklerZoneTimer* x) { x->OnStop(); }, this);
    StartTime = millis() - p;
    PauseTime = 0;
  }

  void stop() {
    PauseTime = 0;
    timer.detach();
  }

  const String toJSON() {
    auto ms = PauseTime ? PauseTime - StartTime : millis() - StartTime;
    auto state = PauseTime ? "paused" : "started";
    return "{ \"state\": \"" + (String)state +
           "\", \"zone\":" + (String)Zone +
           ", \"millis\":" + (String)(ms) +
           ", \"duration\": " + (String)Duration + 
           " }";
  }

 private:
  OnStopCallback OnStop;
  Ticker timer;
};

class SprinklerState {
 public:
  std::map<unsigned int, SprinklerZoneTimer*> Timers;

  bool isEnabled();
  void enable();
  void disable();

  bool isPaused(unsigned int zone);
  bool isWatering(unsigned int zone);
  bool isWatering();
  size_t count();

  typedef std::function<void()> OnStopCallback;
  void start(unsigned int zone, unsigned int duration, OnStopCallback onStop);
  void stop(unsigned int zone);
  void pause(unsigned int zone);
  void resume(unsigned int zone);

  const String toJSON(unsigned int zone);
  const String toJSON();

 private:
  bool enabled = true;
};

#endif