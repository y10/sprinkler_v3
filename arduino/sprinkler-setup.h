#ifndef SPRINKLER_SETUP_H
#define SPRINKLER_SETUP_H

#include "sprinkler-device-wrover.h"
#include "sprinkler.h"

void setupUnit()
{
   pinMode(LED_PIN, OUTPUT);

   uint8_t pins[8] = {RL0_PIN, RL1_PIN, RL2_PIN, RL3_PIN, RL4_PIN, RL5_PIN, RL6_PIN, RL7_PIN};
   for (uint8_t i = 0; i < 8; i++)
   {
      pinMode(pins[i], OUTPUT);
      digitalWrite(pins[i], HIGH);
   }

   Sprinkler.load();
}

#endif