#ifndef SPRINKLER_NTP_H
#define SPRINKLER_NTP_H

#include <Arduino.h>
#include <WiFiUDP.h>
#include <Ticker.h>
#include <TimeLib.h>
#include <TimeAlarms.h>
#include <WsConsole.h>

#include "sprinkler.h"

#define NTP_TIMEZONE 0
#define NTP_SERVER1 "pool.ntp.org"
#define NTP_SERVER2 "time.nist.gov"
#define NTP_SERVER3 "time.google.com"

void setupTime(time_t t = 0);

void handleTicks();

#endif