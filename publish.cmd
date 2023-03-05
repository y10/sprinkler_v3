xcopy /s .\.bin\arduino.ino.bin \\nuc\sites\ota\sprinkler_v3.bin* /Y
rem curl -F "firmware=@./.bin/arduino.ino.bin" http://sprinkler/esp/update