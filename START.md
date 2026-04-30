# Ocuclaw — Project Start Notes

Shared context for future agents working in this repo. Keep current-state only; let `git`/file content carry history.

## Architecture

```
G2 glasses
  ⇅ Bluetooth
Even Realities phone app WebView (loads Vite-built static assets)
  ⇅ HTTP over Wi-Fi (proxy URL + X-Ocuclaw-Key)
Ocuclaw proxy on Mac :8787   (server/openclaw-proxy.mjs)
  ⇅ localhost
OpenClaw Gateway :18789      (chat completions + audio transcriptions)
```

The proxy exists because:

- Phone WebView cannot reach Mac `localhost`.
- OpenClaw Gateway token must stay on Mac, not in the packaged app.
- Proxy enforces `X-Ocuclaw-Key` so random LAN clients cannot use the gateway token.

Proxy reads gateway token from `~/.openclaw/openclaw.json` (`gateway.auth.token`) or env `OPENCLAW_GATEWAY_TOKEN`. Proxy key is generated once at `~/.openclaw/ocuclaw-proxy-key` or set via `OCUCLAW_PROXY_KEY`.

## Files

- `src/main.ts` — phone UI, EvenHub bridge wiring, mode state machine, voice capture, glasses container update.
- `src/glassesView.ts` — pure render of the 576x288 glasses canvas (chat viewport + status bar).
- `src/chatHistory.ts` — turn store, line-wrap, scroll snapshot, persist via `bridge.getLocalStorage`/`setLocalStorage`.
- `src/openclawClient.ts` — fetch wrappers for `/health`, `/chat`, `/transcribe`.
- `src/config.ts` — proxy URL/key load + save (env, runtime config, localStorage).
- `server/openclaw-proxy.mjs` — Node HTTP proxy. Endpoints: `GET /`, `GET /health`, `POST /chat`, `POST /transcribe`.
- `scripts/dev-all.mjs` — run proxy + Vite together.
- `scripts/set-network-whitelist.mjs` — write current LAN origin into `app.json` whitelist and `public/ocuclaw-config.json`. Whitelist ships empty in the repo; run before pack.
- `scripts/whisper-local.mjs`, `scripts/use-whisper-target.mjs` — optional local whisper.cpp setup and `.env` preset switcher.
- `app.json` — EvenHub manifest. Network whitelist must contain the exact proxy origin used at runtime.
- `Makefile` — convenience targets over npm scripts.

## App modes (state machine)

`idle → recording → review → thinking → idle`

- `idle`: viewport is scrollable. Double tap → `recording`.
- `recording`: 16 kHz PCM accumulates; double tap stops, posts WAV to `/transcribe`, transitions to `review`. Auto-stops at `MAX_VOICE_BYTES` (3 MiB).
- `review`: scroll cycles `Send`/`Edit`/`Cancel`. Single tap confirms. `Edit` re-enters `recording` with existing transcript appended on stop.
- `thinking`: `/chat` in flight; input ignored.

## EvenHub input notes

- Enum used: `CLICK_EVENT = 0`, `SCROLL_TOP_EVENT = 1`, `SCROLL_BOTTOM_EVENT = 2`, `DOUBLE_CLICK_EVENT = 3`.
- `sysEvent`/`listEvent` may arrive with `eventType` undefined; that means CLICK (protobuf zero default). `getEventType` handles this fallback.
- Long/held touch shows up as `2` (SCROLL_BOTTOM). No separate long-tap enum in SDK v0.0.10.
- Container `ocuclaw-main` (id 1) is full-screen, `isEventCapture: 1`. Audio events come on the same `onEvenHubEvent` stream as `event.audioEvent.audioPcm` (`Uint8Array`).

## Transcription backends

Proxy posts WAV to an OpenAI-compatible transcription endpoint. Three supported targets, switched via `.env`:

- Local whisper.cpp server on `127.0.0.1:9001` with path `/inference` (default in `.env`).
- OpenAI-compatible cloud (`OPENAI_BASE_URL`, `OPENAI_API_KEY`, default path `/audio/transcriptions`).
- OpenClaw Gateway itself (no `OCUCLAW_TRANSCRIPTION_BASE_URL` / `OPENAI_BASE_URL` set; reuses gateway token).

`scripts/use-whisper-target.mjs <local|core42|openai>` rewrites `.env` to one of the presets.

## Common commands

```bash
npm run dev:all       # proxy + Vite
npm run proxy         # proxy alone (port 8787)
npm run dev           # Vite alone (0.0.0.0:5173)
npm run set:network   # write current Mac LAN URL into app.json + public config
npm run build         # tsc + vite build
npm run pack          # build + create ocuclaw.ehpk
make qr               # generate EvenHub QR for current LAN dev URL
```

## Constraints to remember

- Glasses display: 576 × 288, green-on-black, 4-bit grayscale, system font.
- Network calls in the packaged app must match `app.json` whitelist exactly (origin including scheme, host, port).
- Phone and Mac must be on the same Wi-Fi/LAN with no AP isolation.
- Do not bake the proxy key into `.ehpk`. Only the proxy URL is written by `set:network`.
