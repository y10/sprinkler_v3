#ifndef WsConsole_h
#define WsConsole_h

#include <Arduino.h>
#include <AsyncWebSocket.h>

#include <map>

#include "../../../includes/StreamString.h"

typedef enum {
  logNone = 0,
  logError = 1,
  logWarn = 2,
  logInfo = 3
} logLevel_t;

typedef struct {
  logLevel_t level;
  String scope;
  String entry;
  String toJson() {
    String logLevel = "";
    switch (level) {
      case logError:
        logLevel = "error";
        break;
      case logWarn:
        logLevel = "warn";
        break;
      case logInfo:
        logLevel = "info";
        break;
    }
    return (String) "{ \"scope\": \"" + scope + "\", \"" + logLevel + "\": \"" + entry + "\" }";
  }
} log_t;

class WsConsole : public Print, Printable {
 private:
  String logScope;
  StreamString log;

 public:
  WsConsole() : WsConsole("") {}

  WsConsole(const char *scope);

  WsConsole &logFor(const char *scope);

  void begin(unsigned long baud);

  void attach(AsyncWebSocket *ws);

  void logLevel(logLevel_t logLevel);

  WsConsole &error(const char *scope, const char *line);
  WsConsole &error(const String text);

  WsConsole &warn(const char *scope, String line);
  WsConsole &warn(const char *scope, const char *line);
  WsConsole &warn(const String text);

  virtual size_t write(uint8_t c) override {
    return write(&c, 1);
  }

  virtual size_t write(const uint8_t *data, size_t size) override;

  virtual size_t printTo(Print &p) const override;

  static void clearLogs();

  WsConsole &println(const char *scope, const char *line);

  using Print::println;

 private:
  void broadcast(log_t log);
};

extern WsConsole Console;

#endif