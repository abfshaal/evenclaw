# Glasses Claw

Even Realities G2 app that routes requests to local OpenClaw through a tiny Mac-side proxy.

## Architecture

```txt
G2 glasses
  ⇅ Bluetooth
Even Realities phone app WebView
  ⇅ HTTP over Wi-Fi
Glasses Claw proxy on Mac :8787
  ⇅ localhost + gateway token
OpenClaw Gateway :18789
```

Reason for proxy:

- Phone WebView cannot reach Mac `localhost`.
- OpenClaw Gateway token stays on Mac, not embedded in the glasses app.
- Proxy avoids browser CORS/origin issues against OpenClaw Gateway.
- Proxy requires `X-Glasses-Claw-Key` for `/chat` and `/transcribe`, so random LAN clients cannot use your OpenClaw token indirectly.

## Requirements

- Node.js `20.19+` or `22.12+`
- OpenClaw Gateway running locally on Mac
- Even Realities app + G2 glasses
- Phone and Mac on same Wi-Fi/LAN

Current detected OpenClaw Gateway default:

- `http://127.0.0.1:18789`
- token read from `~/.openclaw/openclaw.json`

## Run locally

Start proxy and Vite in one terminal:

```bash
npm run dev:all
```

Or separate terminals:

```bash
npm run proxy
npm run dev
```

Proxy prints LAN URL and stable proxy key, example:

```bash
LAN URL: http://192.168.1.50:8787
Proxy key: 12ab34cd56ef
Proxy key file: ~/.glasses-claw/proxy-key
```

Enter both values in phone UI. The key is generated once and reused across proxy restarts. Show it anytime:

```bash
make proxy-key
```

Override key manually if needed:

```bash
GLASSES_CLAW_PROXY_KEY=choose-a-local-secret npm run proxy
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

Chat test:

```bash
curl -s http://127.0.0.1:8787/chat \
  -H 'Content-Type: application/json' \
  -H 'X-Glasses-Claw-Key: KEY_PRINTED_BY_PROXY' \
  -d '{"prompt":"Say hello in one short sentence"}'
```

Voice transcription uses `POST /transcribe` with WAV audio. The proxy forwards it to OpenClaw's OpenAI-compatible `/v1/audio/transcriptions` endpoint.

## Sideload to phone/glasses by QR

1. Start app:

   ```bash
   npm run dev:all
   ```

2. Find Mac LAN IP:

   ```bash
   ipconfig getifaddr en0
   ```

3. Generate EvenHub QR for Vite URL:

   ```bash
   npm run qr -- --url http://YOUR_MAC_LAN_IP:5173
   ```

4. Scan QR in Even Realities app developer flow.

The web app defaults proxy URL to same host on port `8787`, so `http://YOUR_MAC_LAN_IP:5173` infers `http://YOUR_MAC_LAN_IP:8787`. Enter proxy key from terminal in phone UI.

## Glasses controls

App is modal. Modes: `idle`, `recording`, `review`, `thinking`.

- Idle:
  - Double tap: start mic recording.
  - Scroll up / scroll down: paginate chat history viewport.
- Recording:
  - Double tap: stop recording and transcribe.
- Review (after transcript returns):
  - Scroll up / scroll down: cycle highlight between `Send` / `Edit` / `Cancel`.
  - Single tap: confirm highlighted choice. `Edit` re-enters recording and appends to current transcript. `Cancel` discards.
- Thinking: input ignored while waiting for Glasses Claw reply.

Phone UI mirrors all of this: edit proxy URL / key, send a typed prompt, start/stop voice manually, clear chat history.

Voice notes:

- EvenHub SDK supports G2 mic capture with `bridge.audioControl(true)` and `event.audioEvent.audioPcm`.
- Audio format is PCM 16 kHz, signed 16-bit little-endian, mono.
- SDK does not provide built-in speech-to-text. Glasses Claw wraps recorded PCM as WAV and sends it through the proxy to OpenClaw's OpenAI-compatible `/v1/audio/transcriptions` endpoint.
- If your OpenClaw Gateway does not expose that endpoint/model, voice capture will work but transcription will fail. Set `OPENCLAW_TRANSCRIPTION_MODEL` if your gateway uses a model name other than `whisper-1`.

EvenHub input notes:

- SDK enum: `CLICK_EVENT = 0`, `SCROLL_TOP_EVENT = 1`, `SCROLL_BOTTOM_EVENT = 2`, `DOUBLE_CLICK_EVENT = 3`.
- `sysEvent` with no explicit `eventType` means CLICK (protobuf zero default). `getEventType` falls back to CLICK on `sysEvent`/`listEvent` when the field is absent.
- Long/held touch observed as event `2` (SCROLL_BOTTOM_EVENT). SDK v0.0.10 has no separate long-tap enum.

## Packaging

EvenHub `app.json` network whitelist must include the exact proxy origin. Before packing, set it to current Mac LAN URL. This also writes `public/glasses-claw-config.json` with proxy URL only:

```bash
npm run set:network
```

Or explicit origin:

```bash
npm run set:network -- http://YOUR_MAC_LAN_IP:8787
```

Then pack:

```bash
npm run pack
```

Output:

```bash
glasses-claw.ehpk
```

Upload `.ehpk` to Even Hub developer portal.

## Notes

- Production Even Hub docs prefer HTTPS for network calls. Local sideload/dev may work with HTTP; portal submission may require HTTPS.
- If phone cannot connect to proxy, check macOS firewall and same Wi-Fi/VPN isolation.
- Do not put OpenClaw Gateway token in frontend code or `app.json`.
- Do not share a packaged `.ehpk` with a baked or reused proxy key. Current script only bakes proxy URL; enter proxy key in phone UI.

## Environment variables

Proxy:

- `GLASSES_CLAW_PROXY_HOST` default `0.0.0.0`
- `GLASSES_CLAW_PROXY_PORT` default `8787`
- `OPENCLAW_BASE_URL` default `http://127.0.0.1:18789`
- `OPENCLAW_GATEWAY_TOKEN` optional override; otherwise read from `~/.openclaw/openclaw.json`
- `OPENCLAW_MODEL` default `openclaw`
- `OPENCLAW_TRANSCRIPTION_MODEL` default `whisper-1`
- `GLASSES_CLAW_MAX_AUDIO_BYTES` default `5242880`
- `GLASSES_CLAW_PROXY_KEY` optional key override; default generated once at `~/.glasses-claw/proxy-key`

Frontend:

- `VITE_GLASSES_CLAW_PROXY_URL` optional default proxy URL override
