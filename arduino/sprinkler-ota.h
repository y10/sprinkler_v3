#include <ArduinoOTA.h>
#include <WiFiUdp.h>
#include <WsConsole.h>

#include <functional>

#include "sprinkler.h"


void setupOTA() {
  if (!Sprinkler.connectedWifi) {
    return;
  }

  static WsConsole console("*ota");

  ArduinoOTA.onStart([]() {
    console.println("Start");
  });
  ArduinoOTA.onEnd([]() {
    console.println("End");
  });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    console.printf("progress: %u%%\r", (progress / (total / 100)));
  });
  ArduinoOTA.onError([](ota_error_t error) {
    char errormsg[100];
    sprintf(errormsg, "Error[%u]: ", error);
    if (error == OTA_AUTH_ERROR)
      strcpy(errormsg + strlen(errormsg), "Auth Failed");
    else if (error == OTA_BEGIN_ERROR)
      strcpy(errormsg + strlen(errormsg), "Begin Failed");
    else if (error == OTA_CONNECT_ERROR)
      strcpy(errormsg + strlen(errormsg), "Connect Failed");
    else if (error == OTA_RECEIVE_ERROR)
      strcpy(errormsg + strlen(errormsg), "Receive Failed");
    else if (error == OTA_END_ERROR)
      strcpy(errormsg + strlen(errormsg), "End Failed");
    console.error(errormsg);
  });
  ArduinoOTA.setHostname(Sprinkler.hostname().c_str());
  ArduinoOTA.begin();
  console.println("Started.");
}

void handleOTA() {
  ArduinoOTA.handle();
}
