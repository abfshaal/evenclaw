SHELL := /bin/bash

LAN_IP ?= $(shell ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)
VITE_PORT ?= 5173
PROXY_PORT ?= 8787
DEV_URL ?= http://$(LAN_IP):$(VITE_PORT)
PROXY_URL ?= http://$(LAN_IP):$(PROXY_PORT)
PROXY_KEY ?=
PROMPT ?= Say hello in one short sentence.

.PHONY: help setup ip proxy proxy-key dev dev-all simulator qr set-network build pack pack-check health chat clean

help:
	@echo "Glasses Claw / Even Realities G2 commands"
	@echo ""
	@echo "Setup:"
	@echo "  make setup          Install npm dependencies"
	@echo "  make ip             Show detected Mac LAN IP and URLs"
	@echo ""
	@echo "Local run:"
	@echo "  make proxy          Start Mac-side Glasses Claw proxy on port $(PROXY_PORT)"
	@echo "  make proxy-key      Show stable proxy key saved on this Mac"
	@echo "  make dev            Start Vite dev server on port $(VITE_PORT)"
	@echo "  make dev-all        Start proxy + Vite together"
	@echo "  make simulator      Start EvenHub simulator against localhost dev URL"
	@echo ""
	@echo "Glasses sideload:"
	@echo "  make qr             Generate EvenHub QR for $(DEV_URL)"
	@echo "  make set-network    Set app.json whitelist + runtime proxy URL to $(PROXY_URL)"
	@echo ""
	@echo "Build/package:"
	@echo "  make build          Typecheck + Vite build"
	@echo "  make pack           Build + create glasses-claw.ehpk"
	@echo "  make pack-check     Build + pack + package ID availability check (needs evenhub login)"
	@echo ""
	@echo "Diagnostics:"
	@echo "  make health         Check Glasses Claw backend health at $(PROXY_URL)/health"
	@echo "  make chat PROXY_KEY=... PROMPT='hello'"
	@echo "  make clean          Remove dist and glasses-claw.ehpk"
	@echo ""
	@echo "Typical dev flow:"
	@echo "  1. make setup"
	@echo "  2. make dev-all"
	@echo "  3. copy Proxy key printed by proxy"
	@echo "  4. make qr"
	@echo "  5. scan QR in Even Realities app"
	@echo ""
	@echo "Typical package flow:"
	@echo "  1. make set-network"
	@echo "  2. make pack"
	@echo "  3. upload glasses-claw.ehpk to Even Hub portal"

setup:
	npm install

ip:
	@echo "LAN_IP=$(LAN_IP)"
	@echo "DEV_URL=$(DEV_URL)"
	@echo "PROXY_URL=$(PROXY_URL)"
	@echo ""
	@echo "Phone/glasses use DEV_URL for QR and PROXY_URL in app settings."
	@echo "Do not use 127.0.0.1 from phone; that points at phone, not Mac."

proxy:
	GLASSES_CLAW_PROXY_PORT=$(PROXY_PORT) npm run proxy

proxy-key:
	@KEY_FILE="$$HOME/.glasses-claw/proxy-key"; \
	LEGACY_KEY_FILE="$$HOME/.openclaw/ocuclaw-proxy-key"; \
	if [ -f "$$KEY_FILE" ]; then \
		echo "Proxy key: $$(cat "$$KEY_FILE")"; \
	elif [ -f "$$LEGACY_KEY_FILE" ]; then \
		echo "Proxy key: $$(cat "$$LEGACY_KEY_FILE")"; \
	else \
		echo "No stable proxy key yet. Run 'make proxy' once to create it."; \
	fi

dev:
	npm run dev

dev-all:
	GLASSES_CLAW_PROXY_PORT=$(PROXY_PORT) npm run dev:all

simulator:
	npm run simulator

qr:
	npm run qr -- --url $(DEV_URL)

set-network:
	GLASSES_CLAW_PROXY_PORT=$(PROXY_PORT) npm run set:network -- $(PROXY_URL)

build:
	npm run build

pack:
	npm run pack

pack-check:
	npm run pack:check

health:
	curl -sS $(PROXY_URL)/health | python3 -m json.tool

chat:
	@if [ -z "$(PROXY_KEY)" ]; then \
		echo "Missing PROXY_KEY. Run 'make proxy' and copy printed key."; \
		echo "Usage: make chat PROXY_KEY=printed-key PROMPT='$(PROMPT)'"; \
		exit 1; \
	fi
	@JSON=$$(PROMPT="$(PROMPT)" python3 -c 'import json, os; print(json.dumps({"prompt": os.environ["PROMPT"]}))'); \
	curl -sS $(PROXY_URL)/chat \
		-H 'Content-Type: application/json' \
		-H 'X-Glasses-Claw-Key: $(PROXY_KEY)' \
		-d "$$JSON" | python3 -m json.tool

clean:
	rm -rf dist glasses-claw.ehpk
