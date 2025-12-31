#include "WsConsole.h"

std::unique_ptr<AsyncWebSocket> wss;
logLevel_t loglevel = logInfo;
std::map<String, WsConsole *> consoles;
std::vector<log_t> logs;
size_t logIndex = 0;

WsConsole::WsConsole(const char *scope)
    : logScope(scope) {
  consoles[scope] = this;
}

WsConsole &WsConsole::logFor(const char *scope) {
  if (consoles.find(scope) == consoles.end()) {
    consoles[scope] = new WsConsole(scope);
  }
  return *consoles[scope];
}

void WsConsole::begin(unsigned long baud) {
  Serial.begin(baud);
  Serial.println();
}

void WsConsole::logLevel(logLevel_t level) { loglevel = level; }

void WsConsole::attach(AsyncWebSocket *wsp) {
  if (loglevel == logNone || wsp == nullptr)
    return;

  if (!wss)
    wss.reset(wsp);
}

WsConsole &WsConsole::error(const char *scope, const char *line) {
  WsConsole &console = logFor(scope);
  console.error(line);
  return console;
}

WsConsole &WsConsole::error(const String text) {
  if (loglevel < logError)
    return *this;

  Serial.printf("[error] %s\r\n", text.c_str());

  broadcast((log_t){
      logError,
      logScope,
      text});
  return *this;
}

WsConsole &WsConsole::warn(const char *scope, String text) {
  WsConsole &console = logFor(scope);
  console.warn(text);
  return console;
}

WsConsole &WsConsole::warn(const char *scope, const char *line) {
  WsConsole &console = logFor(scope);
  console.warn(line);
  return console;
}

WsConsole &WsConsole::warn(const String text) {
  if (loglevel < logWarn)
    return *this;

  Serial.printf("[warn] %s\r\n", text.c_str());

  broadcast((log_t){
      logWarn,
      logScope,
      text});

  return *this;
}

size_t WsConsole::write(const uint8_t *data, size_t size) {
  if (loglevel < logInfo)
    return 0;

  size_t len = log.write(data, size);
  int index = log.indexOf("\r\n");
  if (index != -1) {
    String line = log.substring(0, index);
    Serial.print("[");
    Serial.print(logScope);
    Serial.print("] ");
    Serial.println(line);

    broadcast((log_t){
        logInfo,
        logScope,
        line});

    String rem = log.substring(index + 2);
    log.clear();
    log.concat(rem);
  }

  return len;
}

void WsConsole::broadcast(log_t log) {
  log.scope.replace("\"", "\\\"");
  log.scope.replace("\r", "");
  log.scope.replace("\n", "");
  log.entry.replace("\"", "\\\"");
  log.entry.replace("\r", "");
  log.entry.replace("\n", "");

  logs.push_back(log);

  if (logs.size() > 1000) {
    if (logIndex > 0)
      logIndex--;
    logs.erase(logs.begin());
  }

  if (wss && wss->count() > 0) {
    wss->textAll("{ \"event\": " + log.toJson() + " }");
    logIndex++;
  }
}

size_t WsConsole::printTo(Print &p) const {
  size_t i = 0;
  size_t len = 0;
  len += p.write('[');
  for (auto &log : logs) {
    String json = log.toJson();
    if (i != 0) {
      len += p.write(", ");
    }

    len += p.write(json.c_str(), json.length());
    i++;
  }
  len += p.write(']');
  return len;
}

WsConsole &WsConsole::println(const char *scope, const char *line) {
  WsConsole &console = logFor(scope);
  console.println(line);
  return console;
}

void WsConsole::clearLogs() {
  logs.clear();
  logIndex = 0;
}

WsConsole Console = WsConsole();