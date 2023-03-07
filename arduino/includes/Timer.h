#ifndef SPRINKLER_LIB_Timer_H
#define SPRINKLER_LIB_Timer_H

#include <Ticker.h>

typedef std::function<void(void)> OnTimerTick;

class Timer {
 public:
  void attach(float secconds, OnTimerTick cb) {
    ticker.detach();
    onTick = cb;
    ticker.attach(secconds, OnTick, this);
  };

 private:
  static void OnTick(Timer* timer) {
    timer->onTick();
  }

  OnTimerTick onTick;
  Ticker ticker;
};

#endif