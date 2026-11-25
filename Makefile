PY ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)
PORT ?= 8080
AGENT = PYTHONPATH=agent $(PY) -m musicos_agent --port $(PORT)

.PHONY: help ui ui-dev dev dev-library dev-mpd check image vm deploy test fetch usb clean

help:
	@echo "make ui        build the TV UI (ui/dist)"
	@echo "make ui-dev    Vite dev server with hot reload on :5173 (run an agent too)"
	@echo "make dev       built UI + agent with a fake library (no MPD)"
	@echo "make dev-library LIBRARY=/Volumes/8TB/media/music/library   real covers, simulated playback"
	@echo "make dev-mpd   UI + agent against a local MPD (macOS: brew install mpd)"
	@echo "make check     syntax-check agent, UI and scripts"
	@echo "make image     build out/musicos.raw (Debian trixie build host, needs root)"
	@echo "make vm        boot the image in QEMU on the build host"
	@echo "make deploy    push image to Proxmox and recreate the test VM (PVE_HOST=root@pve)"
	@echo "make test      sync, build on the build VM, deploy, boot-check, screenshot (.pipeline.env)"
	@echo "make fetch     download the latest build as out/musicos.img.gz"
	@echo "make usb DISK=disk4   write out/musicos.img.gz to a USB stick (erases it)"

ui:
	cd ui && npm ci --no-audit --no-fund && npm run build

ui-dev:
	cd ui && npm run dev

dev: ui
	$(AGENT) --mock

LIBRARY ?= /Volumes/8TB/media/music/library
dev-library: ui
	$(AGENT) --library "$(LIBRARY)"

dev-mpd:
	@mkdir -p ~/.musicos-dev/playlists
	@pgrep -x mpd >/dev/null || mpd dev/mpd.conf
	@mpc update >/dev/null 2>&1 || true
	$(AGENT)

check:
	$(PY) -m py_compile agent/musicos_agent/*.py
	cd ui && npx tsc -b
	bash -n scripts/*.sh
	python3 -m py_compile scripts/*.py
	sh -n image/mkosi.postinst.chroot image/mkosi.extra/usr/local/bin/musicos-browser
	@echo ok

image:
	cd image && sudo mkosi -f build

vm:
	cd image && (sudo mkosi vm || sudo mkosi qemu)

deploy:
	./scripts/proxmox-deploy.sh

test:
	./scripts/pve-test.sh

fetch:
	./scripts/fetch-image.sh

usb:
	./scripts/flash-usb.sh out/musicos.img.gz $(DISK)

clean:
	cd image && sudo mkosi clean || true
	rm -rf out
