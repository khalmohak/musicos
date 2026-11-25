PY ?= python3
PORT ?= 8080
AGENT = PYTHONPATH=agent $(PY) -m musicos_agent --port $(PORT)

.PHONY: help dev dev-mpd check image vm deploy test clean

help:
	@echo "make dev       UI + agent with a fake library (any machine, no MPD)"
	@echo "make dev-mpd   UI + agent against a local MPD (macOS: brew install mpd)"
	@echo "make check     syntax-check agent, UI and scripts"
	@echo "make image     build out/musicos.raw (Debian trixie build host, needs root)"
	@echo "make vm        boot the image in QEMU on the build host"
	@echo "make deploy    push image to Proxmox and recreate the test VM (PVE_HOST=root@pve)"
	@echo "make test      sync, build on the build VM, deploy, boot-check, screenshot (.pipeline.env)"

dev:
	$(AGENT) --mock

dev-mpd:
	@mkdir -p ~/.musicos-dev/playlists
	@pgrep -x mpd >/dev/null || mpd dev/mpd.conf
	@mpc update >/dev/null 2>&1 || true
	$(AGENT)

check:
	$(PY) -m py_compile agent/musicos_agent/*.py
	@command -v node >/dev/null && node --check ui/app.js || echo "(node not found, skipped JS check)"
	bash -n scripts/*.sh
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

clean:
	cd image && sudo mkosi clean || true
	rm -rf out
