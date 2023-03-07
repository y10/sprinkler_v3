#include "sprinkler-time.h"

WsConsole timeLog("time");
time_t lastSyncTime = Sprinkler.builtDate();
time_t builtDateTime = Sprinkler.builtDate();

time_t syncTime() {
  timeLog.print("Connecting..");
  int tryCount = 0;
  while (tryCount++ < 12)  // wait for 3 seconds
  {
    delay(250);
    timeLog.print(".");
    lastSyncTime = time(nullptr);
    if (lastSyncTime > builtDateTime) {
      setupTime(lastSyncTime);
      return lastSyncTime;
    }
  }

  setupTime(builtDateTime);
  return (time_t)0;
}

void setupTime(time_t t) {
  if (t) {
    setTime(t);
    Sprinkler.attach();
    timeLog.println();
    if (t == builtDateTime) {
      timeLog.warn(ctime(&t));
    } else {
      timeLog.println(ctime(&t));
    }
  } else if (Sprinkler.connectedWifi) {
    configTime(60 * 60 * NTP_TIMEZONE, 0, NTP_SERVER1, NTP_SERVER2, NTP_SERVER3);
    syncTime();
  }
}

void handleTicks() {
  time_t t = time(nullptr);
  if (t > builtDateTime) {
    Alarm.serviceAlarms();
  } else if (lastSyncTime == t || (t - lastSyncTime) > 60000) {
    syncTime();
  }
}
