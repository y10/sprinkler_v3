/*

FAUXMO ESP

Copyright (C) 2018-2020 by Xose Pérez <xose dot perez at gmail dot com>

The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

*/

#pragma once

PROGMEM const char FAUXMO_TCP_HEADERS[] =
    "HTTP/1.1 %s\r\n"
    "Content-Type: %s\r\n"
    "Content-Length: %d\r\n"
    "Connection: close\r\n\r\n";

PROGMEM const char FAUXMO_TCP_STATE_RESPONSE[] = "["
    "{\"success\":{\"/lights/%d/state/on\":%s}},"
    "{\"success\":{\"/lights/%d/state/bri\":%d}}"   // not needed?
"]";

// Working with gen1 and gen3, ON/OFF/%, gen3 requires TCP port 80
// Updated to match Node-RED virtual Alexa format for better compatibility
// snprintf order: name (%s), uniqueid (%s), state (%s "true"/"false"), bri (%d)
PROGMEM const char FAUXMO_DEVICE_JSON_TEMPLATE[] = "{"
    "\"type\": \"Extended color light\","
    "\"name\": \"%s\","
    "\"uniqueid\": \"%s\","
    "\"modelid\": \"LCT007\","
    "\"manufacturername\": \"Philips\","
    "\"productname\": \"Hue color lamp\","
    "\"state\":{"
        "\"on\": %s,"
        "\"bri\": %d,"
        "\"hue\": 0,"
        "\"sat\": 254,"
        "\"effect\": \"none\","
        "\"xy\": [0,0],"
        "\"ct\": 199,"
        "\"alert\": \"none\","
        "\"colormode\": \"ct\","
        "\"mode\": \"homeautomation\","
        "\"reachable\": true"
    "},"
    "\"swupdate\": {"
        "\"state\": \"noupdates\","
        "\"lastinstall\": \"2024-01-01T00:00:00\""
    "},"
    "\"capabilities\": {"
        "\"certified\": true,"
        "\"control\": {"
            "\"mindimlevel\": 5000,"
            "\"maxlumen\": 600,"
            "\"colorgamuttype\": \"A\","
            "\"colorgamut\": [[0.675,0.322],[0.409,0.518],[0.167,0.04]],"
            "\"ct\": {\"min\": 153,\"max\": 500}"
        "},"
        "\"streaming\": {\"renderer\":true,\"proxy\":false}"
    "},"
    "\"config\": {"
        "\"archetype\": \"sultanbulb\","
        "\"function\": \"mixed\","
        "\"direction\": \"omnidirectional\""
    "},"
    "\"swversion\": \"5.105.0.21169\""
"}";

// Use shorter description template when listing all devices
// Must also include required fields for Alexa compatibility
PROGMEM const char FAUXMO_DEVICE_JSON_TEMPLATE_SHORT[] = "{"
    "\"type\": \"Extended color light\","
    "\"name\": \"%s\","
    "\"uniqueid\": \"%s\","
    "\"modelid\": \"LCT007\","
    "\"manufacturername\": \"Philips\","
    "\"productname\": \"Hue color lamp\","
    "\"state\":{\"on\":false,\"bri\":254,\"reachable\":true},"
    "\"capabilities\":{\"certified\":true,\"streaming\":{\"renderer\":true,\"proxy\":false}},"
    "\"swversion\": \"5.105.0.21169\""
"}";


// Updated to match Node-RED virtual Alexa format
// snprintf order: ip[0-3], port (URLBase), ip[0-3] (friendlyName - NO PORT), mac, mac
PROGMEM const char FAUXMO_DESCRIPTION_TEMPLATE[] =
"<?xml version=\"1.0\" ?>"
"<root xmlns=\"urn:schemas-upnp-org:device-1-0\">"
    "<specVersion><major>1</major><minor>0</minor></specVersion>"
    "<URLBase>http://%d.%d.%d.%d:%d/</URLBase>"
    "<device>"
        "<deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>"
        "<friendlyName>Philips hue (%d.%d.%d.%d)</friendlyName>"
        "<manufacturer>Royal Philips Electronics</manufacturer>"
        "<manufacturerURL>http://www.philips.com</manufacturerURL>"
        "<modelDescription>Philips hue Personal Wireless Lighting</modelDescription>"
        "<modelName>Philips hue bridge 2012</modelName>"
        "<modelNumber>929000226503</modelNumber>"
        "<modelURL>http://www.meethue.com</modelURL>"
        "<serialNumber>%s</serialNumber>"
        "<UDN>uuid:2f402f80-da50-11e1-9b23-%s</UDN>"
        "<presentationURL>index.html</presentationURL>"
    "</device>"
"</root>";

// SSDP Response 1: ST: upnp:rootdevice
// snprintf order: ip[0-3], port, mac (bridgeid), mac (USN)
// Added HOST header like Tasmota
PROGMEM const char FAUXMO_UDP_RESPONSE_TEMPLATE[] =
    "HTTP/1.1 200 OK\r\n"
    "HOST: 239.255.255.250:1900\r\n"
    "CACHE-CONTROL: max-age=100\r\n"
    "EXT:\r\n"
    "LOCATION: http://%d.%d.%d.%d:%d/description.xml\r\n"
    "SERVER: Linux/3.14.0 UPnP/1.0 IpBridge/1.24.0\r\n"
    "hue-bridgeid: %s\r\n"
    "ST: upnp:rootdevice\r\n"
    "USN: uuid:2f402f80-da50-11e1-9b23-%s::upnp:rootdevice\r\n"
    "\r\n";

// SSDP Response 2: ST: uuid:xxx (Tasmota sends this as second packet)
// snprintf order: ip[0-3], port, mac (bridgeid), mac (ST uuid), mac (USN)
PROGMEM const char FAUXMO_UDP_RESPONSE_TEMPLATE_UUID[] =
    "HTTP/1.1 200 OK\r\n"
    "HOST: 239.255.255.250:1900\r\n"
    "CACHE-CONTROL: max-age=100\r\n"
    "EXT:\r\n"
    "LOCATION: http://%d.%d.%d.%d:%d/description.xml\r\n"
    "SERVER: Linux/3.14.0 UPnP/1.0 IpBridge/1.24.0\r\n"
    "hue-bridgeid: %s\r\n"
    "ST: uuid:2f402f80-da50-11e1-9b23-%s\r\n"
    "USN: uuid:2f402f80-da50-11e1-9b23-%s\r\n"
    "\r\n";

// SSDP Response 3: ST: urn:schemas-upnp-org:device:basic:1 (Tasmota sends this as third packet)
// snprintf order: ip[0-3], port, mac (bridgeid), mac (USN)
// Note: Tasmota's USN for this is just the uuid, not uuid::urn:...
PROGMEM const char FAUXMO_UDP_RESPONSE_TEMPLATE_BASIC[] =
    "HTTP/1.1 200 OK\r\n"
    "HOST: 239.255.255.250:1900\r\n"
    "CACHE-CONTROL: max-age=100\r\n"
    "EXT:\r\n"
    "LOCATION: http://%d.%d.%d.%d:%d/description.xml\r\n"
    "SERVER: Linux/3.14.0 UPnP/1.0 IpBridge/1.24.0\r\n"
    "hue-bridgeid: %s\r\n"
    "ST: urn:schemas-upnp-org:device:basic:1\r\n"
    "USN: uuid:2f402f80-da50-11e1-9b23-%s\r\n"
    "\r\n";

// SSDP NOTIFY Advertisement templates (like Node-RED's ssdp:alive)
// These are sent periodically to announce presence on the network
// snprintf order: ip[0-3], port, mac (USN)

// NOTIFY 1: NT: upnp:rootdevice
PROGMEM const char FAUXMO_NOTIFY_TEMPLATE_ROOT[] =
    "NOTIFY * HTTP/1.1\r\n"
    "HOST: 239.255.255.250:1900\r\n"
    "NT: upnp:rootdevice\r\n"
    "NTS: ssdp:alive\r\n"
    "USN: uuid:2f402f80-da50-11e1-9b23-%s::upnp:rootdevice\r\n"
    "CACHE-CONTROL: max-age=1800\r\n"
    "SERVER: node.js/16.20.1 UPnP/1.1 node-ssdp/4.0.1\r\n"
    "LOCATION: http://%d.%d.%d.%d:%d/description.xml\r\n"
    "\r\n";

// NOTIFY 2: NT: urn:schemas-upnp-org:device:basic:1
PROGMEM const char FAUXMO_NOTIFY_TEMPLATE_BASIC[] =
    "NOTIFY * HTTP/1.1\r\n"
    "HOST: 239.255.255.250:1900\r\n"
    "NT: urn:schemas-upnp-org:device:basic:1\r\n"
    "NTS: ssdp:alive\r\n"
    "USN: uuid:2f402f80-da50-11e1-9b23-%s::urn:schemas-upnp-org:device:basic:1\r\n"
    "CACHE-CONTROL: max-age=1800\r\n"
    "SERVER: node.js/16.20.1 UPnP/1.1 node-ssdp/4.0.1\r\n"
    "LOCATION: http://%d.%d.%d.%d:%d/description.xml\r\n"
    "\r\n";

// NOTIFY 3: NT: uuid:xxx
PROGMEM const char FAUXMO_NOTIFY_TEMPLATE_UUID[] =
    "NOTIFY * HTTP/1.1\r\n"
    "HOST: 239.255.255.250:1900\r\n"
    "NT: uuid:2f402f80-da50-11e1-9b23-%s\r\n"
    "NTS: ssdp:alive\r\n"
    "USN: uuid:2f402f80-da50-11e1-9b23-%s\r\n"
    "CACHE-CONTROL: max-age=1800\r\n"
    "SERVER: node.js/16.20.1 UPnP/1.1 node-ssdp/4.0.1\r\n"
    "LOCATION: http://%d.%d.%d.%d:%d/description.xml\r\n"
    "\r\n";
