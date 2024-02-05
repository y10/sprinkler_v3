#ifndef SPRINKLER_HTTP_H
#define SPRINKLER_HTTP_H

#include <AsyncJson.h>
#include <AsyncWebSocket.h>
#include <ESPAsyncWebServer.h>
#include <ESPmDNS.h>
#include <TimeLib.h>
#include <WsConsole.h>

#include "includes/AsyncHTTPAPHandler.h"
#include "includes/AsyncHTTPUpdateHandler.h"
#include "includes/AsyncHTTPUpgradeHandler.h"
#include "includes/StreamString.h"
#include "includes/files.h"
#include "sprinkler.h"

AsyncWebServer http(80);
AsyncWebSocket ws("/ws");

void ok(AsyncWebServerRequest *request) {
  request->send(200);
}

void ok(AsyncWebServerRequest *request, const String text) {
  request->send(200, "text/html", text);
}

void error(AsyncWebServerRequest *request, const String text) {
  request->send(500, "text/html", text);
}

void json(AsyncWebServerRequest *request, const String text) {
  request->send(200, "application/json", text);
}

void gzip(AsyncWebServerRequest *request, const char *contentType, const unsigned char *content, size_t contentLength) {
  if (!request->header("If-Modified-Since").equals(Sprinkler.builtDateString())) {
    AsyncWebServerResponse *response = request->beginResponse_P(200, contentType, content, contentLength);
    response->addHeader("Content-Encoding", "gzip");
    response->addHeader("Last-Modified", Sprinkler.builtDateString());
    request->send(response);
  } else {
    request->send(304);
  }
}

void setupHttp() {
  static WsConsole console("http");

  Sprinkler.on("state", [](const char *event) {
    ws.textAll((String) "{ \"state\": " + (String)(strlen(event) ? event : "null") + "}");
  });

  http.on("/", [&](AsyncWebServerRequest *rqt) { gzip(rqt, "text/html", SKETCH_INDEX_HTML_GZ, sizeof(SKETCH_INDEX_HTML_GZ)); });
  http.on("/favicon.png", [&](AsyncWebServerRequest *rqt) { gzip(rqt, "image/png", SKETCH_FAVICON_PNG_GZ, sizeof(SKETCH_FAVICON_PNG_GZ)); });
  http.on("/favicon.ico", [&](AsyncWebServerRequest *rqt) { gzip(rqt, "image/x-icon", SKETCH_FAVICON_PNG_GZ, sizeof(SKETCH_FAVICON_PNG_GZ)); });
  http.on("/apple-touch-icon.png", [&](AsyncWebServerRequest *rqt) { gzip(rqt, "image/png", SKETCH_APPLE_TOUCH_ICON_PNG_GZ, sizeof(SKETCH_APPLE_TOUCH_ICON_PNG_GZ)); });
  http.on("/manifest.json", [&](AsyncWebServerRequest *rqt) { gzip(rqt, "application/json", SKETCH_MANIFEST_JSON_GZ, sizeof(SKETCH_MANIFEST_JSON_GZ)); });
  http.on("/js/setup.js", [&](AsyncWebServerRequest *rqt) { gzip(rqt, "application/javascript", SKETCH_SETUP_JS_GZ, sizeof(SKETCH_SETUP_JS_GZ)); });

  http.on("/api/state", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    json(request, Sprinkler.Timers.toJSON());
  });

  http.on("/api/zone/{}/state", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    uint8_t rel = request->pathArg(0).toInt();
    json(request, Sprinkler.Timers.toJSON(rel));
  });

  http.on("/api/zone/{}/start", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    uint8_t rel = request->pathArg(0).toInt();
    uint8_t dur = request->hasArg("d") ? request->arg("d").toInt() : 5;
    console.println("GET: /api/zone/" + (String)rel + "/start?d=" + (String)dur);
    Sprinkler.start(rel, dur);
    json(request, Sprinkler.Timers.toJSON(rel));
  });
  http.on("/api/zone/{}/stop", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    uint8_t rel = request->pathArg(0).toInt();
    Sprinkler.stop(rel);
    json(request, Sprinkler.Timers.toJSON(rel));
  });
  http.on("/api/zone/{}/pause", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    uint8_t rel = request->pathArg(0).toInt();
    Sprinkler.pause(rel);
    json(request, Sprinkler.Timers.toJSON(rel));
  });
  http.on("/api/zone/{}/resume", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    uint8_t rel = request->pathArg(0).toInt();
    Sprinkler.resume(rel);
    json(request, Sprinkler.Timers.toJSON(rel));
  });

  http.on("/api/relay/{}/{}", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    uint8_t rel = request->pathArg(0).toInt();
    uint8_t val = LOW;
    if (request->pathArg(1) == "toggle") {
      val = Sprinkler.Device.toggle(rel);
    } else if (request->pathArg(1) == "on") {
      Sprinkler.Device.turnOn(rel);
      val = HIGH;
    } else {
      Sprinkler.Device.turnOff(rel);
    }

    console.println((String) "rel:" + rel + " value:" + val);
    json(request, (String) "{\"rel\":" + rel + ", \"value\":" + val + "}");
  });

  http.on("/api/pin/{}/{}", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    uint8_t pin = request->pathArg(0).toInt();
    uint8_t val = LOW;

    if (request->pathArg(1) == "toggle") {
      val = digitalRead(pin) == HIGH ? LOW : HIGH;
    } else if (request->pathArg(1) == "on") {
      val = HIGH;
    }

    if (val) {
      digitalWrite(pin, HIGH);
      val = HIGH;
    } else {
      digitalWrite(pin, LOW);
      val = LOW;
    }

    console.println((String) "pin:" + pin + " value:" + val);
    json(request, (String) "{\"pin\":" + pin + ", \"value\":" + val + "}");
  });

  http.on("/api/schedule", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    json(request, (String) "{ \"state\": \"" + String(Sprinkler.isEnabled() ? "enabled" : "disabled") + "\" }");
  });

  http.on("/api/schedule/{}", ASYNC_HTTP_POST, [&](AsyncWebServerRequest *request) {
    String command = request->pathArg(0);
    console.println("POST: /api/schedule/" + command);
    if (command == "enable") {
      Sprinkler.enable();
    }
    else {
      Sprinkler.disable();
    }
    json(request, (String) "{ \"state\": \"" + String(Sprinkler.isEnabled() ? "enabled" : "disabled") + "\" }");
  });

  http.on("/api/settings/general", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    json(request, (String) "{ \"name\": \"" + Sprinkler.dispname() + "\", \"host\": \"" + Sprinkler.hostname() + "\" }");
  });
  http.on("/api/settings/zones", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    json(request, Sprinkler.Settings.toJSON());
  });
  http.on("/api/settings", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    json(request, Sprinkler.toJSON());
  });

  http.addHandler(new AsyncCallbackJsonWebHandler(
      "/api/settings", [&](AsyncWebServerRequest *request, JsonVariant &jsonDoc) {
        JsonObject jsonObj = jsonDoc.as<JsonObject>();
        console.println("POST: /api/settings");
        if (!Sprinkler.fromJSON(jsonObj)) {
          error(request, "Failed to save settings");
        } else {
          json(request, Sprinkler.toJSON());
        }
      },
      4096));

  http.on("/esp/log", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    StreamString jStream;
    Console.printTo(jStream);
    json(request, jStream);
  });

  http.on("/esp/logLevel", ASYNC_HTTP_POST, [&](AsyncWebServerRequest *request) {
    const char *logLevel = request->arg("level").c_str();
    console.printf("POST: /esp/logLevel?level=%s", logLevel);
    console.println();
    Sprinkler.logLevel(logLevel);
    Sprinkler.save();
    Sprinkler.restart();
  });

  http.on("/esp/time", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    time_t t = now();
    json(request, (String) "{ \"d\": \"" + (String)day(t) + " " + (String)monthShortStr(month(t)) + " " + (String)year(t) + "\", \"h\": \"" + hour(t) + "\", \"m\": \"" + minute(t) + "\", \"s\": \"" + second(t) + "\" }");
  });

  http.on("/esp/restart", ASYNC_HTTP_POST, [&](AsyncWebServerRequest *request) {
    Sprinkler.restart();
  });

  http.on("/esp/reset", ASYNC_HTTP_POST, [&](AsyncWebServerRequest *request) {
    Sprinkler.reset();
  });

  http.addHandler(new AsyncHTTPUpdateHandler("/esp/update", ASYNC_HTTP_POST));

  http.addHandler(new AsyncHTTPUpgradeHandler("/esp/upgrade", ASYNC_HTTP_POST, "https://ota.voights.net/sprinkler_v3.bin"));

  http.onNotFound([&](AsyncWebServerRequest *request) {
    console.println("(404): " + request->url());
    if (!captivePortal(request)) {
      AsyncResponseStream *response = request->beginResponseStream("text/html");
      response->print("<!DOCTYPE html><html><head><title>URI Not Found</title></head><body>");
      response->printf("<p>You were trying to reach: http://%s%s</p>", request->host().c_str(), request->url().c_str());
      response->printf("<p>Try opening <a href='http://%s'>this link</a> instead</p>", WiFi.softAPIP().toString().c_str());
      response->print("</body></html>");
      request->send(response);
    }
  });

  ws.onEvent([&](AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len) {
    IPAddress ip = client->remoteIP();
    uint32_t id = client->id();
    String url = server->url();
    switch (type) {
      case WS_EVT_CONNECT:
        Serial.printf("[%u] Connected from %d.%d.%d.%d url: %s\n", id, ip[0], ip[1], ip[2], ip[3], url.c_str());
        server->text(id, "{\"connection\": \"Connected\"}");
        Console.attach(&ws);
        break;
      case WS_EVT_DISCONNECT:
        Serial.printf("[%u] Disconnected!\n", id);
        break;
      case WS_EVT_PONG:
        Serial.printf("[%u] Pong [%u]: %s\n", id, len, (len) ? (char *)data : "");
        break;
      case WS_EVT_ERROR:
        Serial.printf("[%u] Error (%u): %s\n", id, *((uint16_t *)arg), (char *)data);
        break;
    }
  });
  http.addHandler(&ws);
  Console.println("*wss", "Started.");

  http.begin();
  console.println("Started.");

  if (MDNS.begin(Sprinkler.hostname().c_str())) {
    Console.println("mdsn", "Started.");
  }
}

#endif