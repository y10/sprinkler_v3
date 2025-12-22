# Sprinkler Controller

Firmware to turn your [ESP32](https://en.wikipedia.org/wiki/ESP32) device into a sprinkler station that can control up to 6 zones  **from your phone, no cloud, no app installation**, just hook up it to your local Wi-Fi network, set the number of zones and you're good to go. 
_Written in [Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=vsciot-vscode.vscode-arduino) for Arduino IDE._

If you like my **Sprinkler Controller**, give it a star, or fork it and contribute!

![Screenshot 1](/docs/Screenshot_1.png)
![Screenshot 2](/docs/Screenshot_2.png)
![Screenshot 3](/docs/Screenshot_3.png)
![Screenshot 4](/docs/Screenshot_4.png)

## Development

### Prerequisites
- [Deno](https://deno.land/) (v2.0+) - for building web assets
- [arduino-cli](https://arduino.github.io/arduino-cli/) - for compiling firmware (included in `tools/`)
- ESP32 Arduino core 2.0.x (install via `tools/arduino-cli core install esp32:esp32@2.0.17`)

### Setup
1. Clone the project from [GitHub](https://github.com/y10/sprinkler_v3)
2. Open **Visual Studio Code** and select the project root folder

### Build Commands
```bash
# Build web assets (generates C headers from HTML/JS)
deno task build

# Compile firmware
tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino

# Or use VS Code build task (Ctrl+Shift+B)
```

### Project Structure
- `html/` - Web UI source files (edit these)
- `arduino/` - Firmware source and libraries
- `arduino/html/` - Generated files (don't edit directly)
- `.sprinkler/settings.json` - Build configuration

Happy coding.

## Disclaimer

:warning: **DANGER OF ELECTROCUTION** :warning:

If your device connects to mains electricity (AC power) there is danger of electrocution if not installed properly. If you don't know how to install it, please call an electrician (***Beware:*** certain countries prohibit installation without a licensed electrician present). Remember: _**SAFETY FIRST**_. It is not worth the risk to yourself, your family and your home if you don't know exactly what you are doing. Never tinker or try to flash a device using the serial programming interface while it is connected to MAINS ELECTRICITY (AC power).

We don't take any responsibility nor liability for using this software nor for the installation or any tips, advice, videos, etc. given by any member of this site or any related site.

## Resources
* [ESP32 Pinout Reference](https://lastminuteengineers.com/esp32-pinout-reference/)

## Site
![Image 1](/docs/Image_1.jpg)
