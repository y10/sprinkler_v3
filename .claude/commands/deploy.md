---
description: Build HTML, compile firmware, and upload OTA to the device (same as the "Publish OTA" VS Code task).
argument-hint: "[deviceIP]"
---

# Deploy

Build the web UI, compile the ESP32 firmware, and upload it OTA to the device. Mirrors the `Publish OTA` task in `.vscode/tasks.json`.

## Arguments

- `$1` (optional): device IP address. Defaults to `192.168.1.100`.

## Steps

1. Resolve the target IP:
   - If `$1` is provided, use it.
   - Otherwise default to `192.168.1.100`.

2. Run the three stages sequentially via the Bash tool, **in a single chained command** (each stage must succeed before the next runs):

   ```
   deno task build && deno task compile && deno run --allow-read --allow-run upload.ts <IP>
   ```

   Substitute `<IP>` with the resolved address. Use a 10 minute timeout (`timeout: 600000`) — the compile stage is the long pole.

3. Report the outcome to the user:
   - On success: confirm which IP was deployed to and surface the final upload output (success message / new version).
   - On failure: identify which stage failed (build / compile / upload) and show the relevant error excerpt.

## Notes

- Do NOT skip stages or substitute `build:dev` — `Publish OTA` always uses the production build.
- Do NOT commit, push, or modify git state.
- If `upload.ts` reports the device is unreachable, suggest the user verify the IP and that the device is on the same network.
