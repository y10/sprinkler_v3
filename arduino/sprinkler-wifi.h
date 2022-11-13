#ifndef SPRINKLER_WIFI_H
#define SPRINKLER_WIFI_H

#include <ESPAsyncDNSServer.h>
#include <WiFi.h>
#include <WsConsole.h>
#include <esp_wifi.h>
#include <WsConsole.h>

#include "Sprinkler.h"

IPAddress apIP(8, 8, 4, 4);
IPAddress subnet(255, 255, 255, 0);

AsyncDNSServer dnsServer;
WsConsole wifiLog("wifi");

bool enableWifi() {
  String hostname = Sprinkler.hostname();
  WiFi.mode(WIFI_AP);
  wifiLog.println("Starting...");
  if (WiFi.softAPConfig(apIP, apIP, subnet) && WiFi.softAP(hostname.c_str())) {
    wifiLog.println(hostname.c_str());
    wifiLog.println(WiFi.softAPIP());
    wifiLog.println("Started.");
    return true;
  } else {
    wifiLog.error("Could not start AP!");
    return false;
  }
}

bool connectWifi(String ssid, String pass) {
  wifiLog.print("Connecting to '");
  wifiLog.print(ssid);
  wifiLog.println("'");

  if (WiFi.begin(ssid.c_str(), pass.c_str()) && WiFi.waitForConnectResult() == WL_CONNECTED) {
    wifiLog.println(WiFi.localIP());
    wifiLog.println("Connected.");
    Sprinkler.connectedWifi = WiFi.enableSTA(true);
    return Sprinkler.connectedWifi;
  }

  wifiLog.print("Could not connect to '");
  wifiLog.print(ssid.c_str());
  if (!pass.isEmpty()) {
    wifiLog.print("' using password '");
    wifiLog.print(pass.c_str());
  }
  wifiLog.println("'");
  return false;
}

bool connectWifi() {
  WiFi.mode(WIFI_STA);
  wifiLog.println("Connecting...");
  if (WiFi.begin() && WiFi.waitForConnectResult(3000) == WL_CONNECTED) {
    wifiLog.println(WiFi.localIP());
    wifiLog.println("Connected.");
    Sprinkler.connectedWifi = true;
    return true;
  }

  return Sprinkler.wifissid(true).length() && connectWifi(Sprinkler.wifissid(true), Sprinkler.wifipass(true));
}

void setupWifi() {
  WiFi.setSleep(false);
  WiFi.hostname(Sprinkler.hostname());
  WiFi.useStaticBuffers(true);
  
  if (connectWifi()) {
    return;
  }

  if (!enableWifi()) {
    ESP.restart();
  }
}

void setupDhcp() {
  if (!Sprinkler.connectedWifi) {
    // modify TTL associated  with the domain name (in seconds)
    // default is 60 seconds
    dnsServer.setTTL(300);
    // set which return code will be used for all other domains (e.g. sending
    // ServerFailure instead of NonExistentDomain will reduce number of queries
    // sent by clients)
    // default is AsyncDNSReplyCode::NonExistentDomain
    dnsServer.setErrorReplyCode(AsyncDNSReplyCode::NoError);
    if (dnsServer.start(53, "*", apIP)) {
      Console.println("dhcp", "Started.");
    } else {
      Console.error("dhcp", "Could not start Captive DNS Server!.");
      ESP.restart();
    }
  }
}

void handleWifi() {
  if (Sprinkler.wifissid().length() && !Sprinkler.connectedWifi) {
    if (!connectWifi(Sprinkler.wifissid(), Sprinkler.wifipass())) {
      ESP.restart();
    }
  }
}


#endif
