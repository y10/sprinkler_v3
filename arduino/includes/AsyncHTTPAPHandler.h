#ifndef AsyncHTTPAceesPointHandler_H
#define AsyncHTTPAceesPointHandler_H

#include <ESPAsyncWebServer.h>

String toStringIp(IPAddress ip) {
  String res = "";
  for (int i = 0; i < 3; i++) {
    res += String((ip >> (8 * i)) & 0xFF) + ".";
  }
  res += String(((ip >> 8 * 3)) & 0xFF);
  return res;
}

boolean isIp(String str) {
  for (unsigned int i = 0; i < str.length(); i++) {
    int c = str.charAt(i);
    if (c != '.' && (c < '0' || c > '9')) {
      return false;
    }
  }
  return true;
}

/**
 * HTTPD redirector
 * Redirect to captive portal if we got a request for another domain.
 * Return true in that case so the page handler do not try to handle the request again.
 */
boolean captivePortal(AsyncWebServerRequest *request) {
  if (!isIp(request->host())) {
    String location = String("http://") + toStringIp(request->client()->localIP());
    Serial.println("[http] Redirect to: " + location);
    AsyncWebServerResponse *response = request->beginResponse(302, "text/plain", "");
    response->addHeader("Location", location);
    request->send(response);
    return true;
  }

  return false;
}


#endif