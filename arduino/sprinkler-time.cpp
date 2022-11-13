#include "sprinkler-time.h"

WsConsole timeLog("time");
time_t builtDateTime = (time_t)0;
time_t lastSyncTime = (time_t)0;

time_t syncTime() {
  timeLog.println("Connecting time server...");
  int tryCount = 0;
  while (tryCount++ < 8)  // wait for 2 seconds
  {
    delay(250);
    Serial.print(".");
    time_t t = lastSyncTime = now();
    if (t > builtDateTime) {
      Serial.println(".");
      setTime(t);
      timeLog.println((String)day(t) + " " + (String)monthShortStr(month(t)) + " " + (String)year(t) + " " + (String)hour(t) + ":" + (String)minute(t));
      Sprinkler.attach();
      return t;
    }
  }
  return (time_t)0;
}

void setupNtp() {
  setSyncProvider(0);
  configTime(60 * 60 * NTP_TIMEZONE, 0, NTP_SERVER1, NTP_SERVER2, NTP_SERVER3);
  if (!syncTime()) {
    setTime(builtDateTime);
    Sprinkler.attach();
    timeLog.warn("Failed.");
  }
}

void setupTime() {
  builtDateTime = Sprinkler.builtDate();

  if (Sprinkler.connectedWifi) {
    setupNtp();
  } else {
    timeLog.println(Sprinkler.builtDateString());
  }
}

void handleTicks() {
  time_t t = now();
  if (t < builtDateTime) {
    if ((t - lastSyncTime) > 60000) {
      if (!syncTime()) return;
    }
  }

  Alarm.serviceAlarms();
}
