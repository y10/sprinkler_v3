#!/usr/bin/env python3
"""
Alexa Discovery Capture Tool

Compares SSDP and HTTP responses between different Hue emulation implementations.
Use this to debug why one device is discovered by Alexa and another is not.

Usage:
    python alexa_capture.py                    # Capture all SSDP responses
    python alexa_capture.py --compare IP1 IP2  # Compare two specific devices
    python alexa_capture.py --fetch IP:PORT    # Fetch /description.xml from device
    python alexa_capture.py --lights IP:PORT   # Fetch /api/lights from device
"""

import socket
import struct
import time
import argparse
import sys
import json
from datetime import datetime
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# SSDP Configuration
SSDP_ADDR = "239.255.255.250"
SSDP_PORT = 1900
SSDP_MX = 3  # Max wait time in seconds

# M-SEARCH message (what Alexa sends)
MSEARCH_MSG = (
    "M-SEARCH * HTTP/1.1\r\n"
    "HOST: 239.255.255.250:1900\r\n"
    "MAN: \"ssdp:discover\"\r\n"
    "MX: 3\r\n"
    "ST: upnp:rootdevice\r\n"
    "\r\n"
)

# Alternative M-SEARCH (some Echo devices use this)
MSEARCH_MSG_ALT = (
    "M-SEARCH * HTTP/1.1\r\n"
    "HOST: 239.255.255.250:1900\r\n"
    "MAN: \"ssdp:discover\"\r\n"
    "MX: 3\r\n"
    "ST: urn:schemas-upnp-org:device:basic:1\r\n"
    "\r\n"
)


def get_local_ip():
    """Get the local IP address that can reach the internet."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "0.0.0.0"


def send_msearch(timeout=5, use_alt=False):
    """Send M-SEARCH and collect all responses."""
    responses = []
    local_ip = get_local_ip()

    print(f"\n{'='*60}")
    print(f"SSDP M-SEARCH Capture")
    print(f"{'='*60}")
    print(f"Local IP: {local_ip}")
    print(f"Sending to: {SSDP_ADDR}:{SSDP_PORT}")
    print(f"Timeout: {timeout}s")
    print(f"ST: {'urn:schemas-upnp-org:device:basic:1' if use_alt else 'upnp:rootdevice'}")
    print(f"{'='*60}\n")

    # Create UDP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.settimeout(timeout)

    # Bind to local interface
    sock.bind((local_ip, 0))
    local_port = sock.getsockname()[1]
    print(f"Bound to {local_ip}:{local_port}")

    # Send M-SEARCH
    msg = MSEARCH_MSG_ALT if use_alt else MSEARCH_MSG
    print(f"\nSending M-SEARCH:\n{'-'*40}")
    print(msg)
    print(f"{'-'*40}\n")

    sock.sendto(msg.encode(), (SSDP_ADDR, SSDP_PORT))
    send_time = time.time()

    print("Waiting for responses...\n")

    # Collect responses
    while True:
        try:
            data, addr = sock.recvfrom(2048)
            recv_time = time.time()
            delay_ms = (recv_time - send_time) * 1000

            response = {
                'ip': addr[0],
                'port': addr[1],
                'delay_ms': delay_ms,
                'raw': data,
                'text': data.decode('utf-8', errors='replace'),
                'headers': parse_ssdp_response(data.decode('utf-8', errors='replace'))
            }
            responses.append(response)

            print(f"[{len(responses)}] Response from {addr[0]}:{addr[1]} (delay: {delay_ms:.0f}ms)")

        except socket.timeout:
            break
        except Exception as e:
            print(f"Error receiving: {e}")
            break

    sock.close()
    return responses


def parse_ssdp_response(text):
    """Parse SSDP response headers into dict."""
    headers = {}
    lines = text.split('\r\n')

    if lines:
        headers['_status'] = lines[0]

    for line in lines[1:]:
        if ':' in line:
            key, value = line.split(':', 1)
            headers[key.strip().upper()] = value.strip()

    return headers


def print_response_detail(response, index=None):
    """Print detailed response information."""
    prefix = f"[{index}] " if index is not None else ""
    print(f"\n{prefix}Response from {response['ip']}:{response['port']}")
    print(f"{'='*60}")
    print(f"Delay: {response['delay_ms']:.0f}ms")
    print(f"Size: {len(response['raw'])} bytes")
    print(f"\nHeaders:")
    for key, value in response['headers'].items():
        print(f"  {key}: {value}")
    print(f"\nRaw Response:")
    print(f"{'-'*40}")
    print(response['text'])
    print(f"{'-'*40}")


def fetch_description_xml(ip_port):
    """Fetch and display /description.xml from a device."""
    if ':' not in ip_port:
        ip_port = f"{ip_port}:80"

    url = f"http://{ip_port}/description.xml"
    print(f"\n{'='*60}")
    print(f"Fetching: {url}")
    print(f"{'='*60}\n")

    try:
        req = Request(url, headers={'User-Agent': 'Alexa/2.0'})
        with urlopen(req, timeout=5) as response:
            content = response.read().decode('utf-8')
            print(f"Status: {response.status}")
            print(f"Headers:")
            for key, value in response.headers.items():
                print(f"  {key}: {value}")
            print(f"\nContent ({len(content)} bytes):")
            print(f"{'-'*40}")
            print(content)
            print(f"{'-'*40}")
            return content
    except HTTPError as e:
        print(f"HTTP Error {e.code}: {e.reason}")
        return None
    except URLError as e:
        print(f"URL Error: {e.reason}")
        return None
    except Exception as e:
        print(f"Error: {e}")
        return None


def fetch_lights_api(ip_port, user="nouser"):
    """Fetch Hue lights API from device."""
    if ':' not in ip_port:
        ip_port = f"{ip_port}:80"

    url = f"http://{ip_port}/api/{user}/lights"
    print(f"\n{'='*60}")
    print(f"Fetching: {url}")
    print(f"{'='*60}\n")

    try:
        req = Request(url, headers={'User-Agent': 'Alexa/2.0'})
        with urlopen(req, timeout=5) as response:
            content = response.read().decode('utf-8')
            print(f"Status: {response.status}")
            print(f"\nContent ({len(content)} bytes):")
            print(f"{'-'*40}")
            try:
                data = json.loads(content)
                print(json.dumps(data, indent=2))
            except json.JSONDecodeError:
                print(content)
            print(f"{'-'*40}")
            return content
    except HTTPError as e:
        print(f"HTTP Error {e.code}: {e.reason}")
        try:
            error_content = e.read().decode('utf-8')
            print(f"Response: {error_content}")
        except:
            pass
        return None
    except URLError as e:
        print(f"URL Error: {e.reason}")
        return None
    except Exception as e:
        print(f"Error: {e}")
        return None


def compare_responses(responses, ip1, ip2):
    """Compare SSDP responses from two IPs."""
    r1 = next((r for r in responses if r['ip'] == ip1), None)
    r2 = next((r for r in responses if r['ip'] == ip2), None)

    print(f"\n{'='*60}")
    print(f"Comparing: {ip1} vs {ip2}")
    print(f"{'='*60}\n")

    if not r1:
        print(f"WARNING: No response from {ip1}")
    if not r2:
        print(f"WARNING: No response from {ip2}")

    if not r1 or not r2:
        return

    # Compare headers
    all_headers = set(r1['headers'].keys()) | set(r2['headers'].keys())

    print(f"{'Header':<20} {'Device 1 (' + ip1 + ')':<35} {'Device 2 (' + ip2 + ')':<35}")
    print(f"{'-'*90}")

    for header in sorted(all_headers):
        v1 = r1['headers'].get(header, '(missing)')
        v2 = r2['headers'].get(header, '(missing)')

        # Truncate long values
        v1_disp = v1[:32] + '...' if len(str(v1)) > 35 else v1
        v2_disp = v2[:32] + '...' if len(str(v2)) > 35 else v2

        match = "  " if v1 == v2 else "!="
        print(f"{header:<20} {str(v1_disp):<35} {match} {str(v2_disp):<35}")

    print(f"\nSize comparison: {len(r1['raw'])} bytes vs {len(r2['raw'])} bytes")
    print(f"Delay comparison: {r1['delay_ms']:.0f}ms vs {r2['delay_ms']:.0f}ms")


def compare_description_xml(ip1_port, ip2_port):
    """Compare /description.xml from two devices."""
    print(f"\n{'='*60}")
    print(f"Comparing description.xml")
    print(f"{'='*60}")

    xml1 = fetch_description_xml(ip1_port)
    xml2 = fetch_description_xml(ip2_port)

    if xml1 and xml2:
        print(f"\n{'='*60}")
        print("XML Comparison (line by line)")
        print(f"{'='*60}\n")

        lines1 = xml1.split('><')
        lines2 = xml2.split('><')

        max_lines = max(len(lines1), len(lines2))

        for i in range(max_lines):
            l1 = lines1[i] if i < len(lines1) else "(missing)"
            l2 = lines2[i] if i < len(lines2) else "(missing)"

            match = "==" if l1 == l2 else "!="

            # Clean up for display
            l1_clean = l1.strip()[:40]
            l2_clean = l2.strip()[:40]

            if l1 != l2:
                print(f"\n[{i}] DIFFERENCE:")
                print(f"  Device 1: {l1[:70]}")
                print(f"  Device 2: {l2[:70]}")


def main():
    parser = argparse.ArgumentParser(description='Alexa Discovery Capture Tool')
    parser.add_argument('--compare', nargs=2, metavar=('IP1', 'IP2'),
                        help='Compare SSDP responses from two IPs')
    parser.add_argument('--fetch', metavar='IP:PORT',
                        help='Fetch /description.xml from device')
    parser.add_argument('--lights', metavar='IP:PORT',
                        help='Fetch /api/lights from device')
    parser.add_argument('--timeout', type=int, default=5,
                        help='SSDP response timeout in seconds (default: 5)')
    parser.add_argument('--alt', action='store_true',
                        help='Use alternative ST header (device:basic:1)')
    parser.add_argument('--compare-xml', nargs=2, metavar=('IP1:PORT', 'IP2:PORT'),
                        help='Compare description.xml from two devices')

    args = parser.parse_args()

    print(f"\nAlexa Discovery Capture Tool")
    print(f"Time: {datetime.now().isoformat()}")

    if args.fetch:
        fetch_description_xml(args.fetch)
        return

    if args.lights:
        fetch_lights_api(args.lights)
        return

    if args.compare_xml:
        compare_description_xml(args.compare_xml[0], args.compare_xml[1])
        return

    # Send M-SEARCH and capture responses
    responses = send_msearch(timeout=args.timeout, use_alt=args.alt)

    print(f"\n{'='*60}")
    print(f"Summary: {len(responses)} responses received")
    print(f"{'='*60}")

    # Group by IP
    by_ip = {}
    for r in responses:
        if r['ip'] not in by_ip:
            by_ip[r['ip']] = []
        by_ip[r['ip']].append(r)

    print(f"\nResponding devices:")
    for ip, resps in by_ip.items():
        location = resps[0]['headers'].get('LOCATION', 'unknown')
        server = resps[0]['headers'].get('SERVER', 'unknown')
        print(f"  {ip}: {len(resps)} packet(s)")
        print(f"    LOCATION: {location}")
        print(f"    SERVER: {server}")

    # Show detailed responses
    for i, response in enumerate(responses):
        print_response_detail(response, i + 1)

    # Compare if requested
    if args.compare:
        compare_responses(responses, args.compare[0], args.compare[1])


if __name__ == '__main__':
    main()
