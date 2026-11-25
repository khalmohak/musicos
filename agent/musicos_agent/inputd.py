"""musicos-input: game controllers, IR receivers and HDMI-CEC remotes -> keys the UI understands.

Runs as root (needs /dev/input and /dev/uinput). Every supported device is grabbed and its
buttons are re-emitted from one virtual keyboard, "musicos-remote", so the browser only ever
sees plain key presses. Ordinary keyboards are left alone.

Controller layout (Xbox names; PlayStation in brackets):
  D-pad / left stick   arrows          A (Cross)       OK (Enter)
  B (Circle)           Back (Esc)      Y (Triangle)    Now playing (F1)
  X (Square)           Search (F3)     View/Share      Settings (F2)
  Menu/Options/Start   Play/pause      Guide/PS        Home (F4); hold 1 s: power menu (F5)
  LB / RB              Prev / next     LT / RT         Volume down / up
"""
import asyncio
import os
import time

from evdev import InputDevice, UInput, ecodes as e, list_devices

REPEAT_DELAY, REPEAT_RATE, REPEAT_FAST = 0.38, 0.12, 0.06  # seconds
STICK_THRESHOLD = 0.55  # fraction of the axis range before a stick push counts

OUT_KEYS = [e.KEY_UP, e.KEY_DOWN, e.KEY_LEFT, e.KEY_RIGHT, e.KEY_ENTER, e.KEY_ESC, e.KEY_PLAYPAUSE,
            e.KEY_NEXTSONG, e.KEY_PREVIOUSSONG, e.KEY_VOLUMEUP, e.KEY_VOLUMEDOWN, e.KEY_STOPCD,
            e.KEY_F1, e.KEY_F2, e.KEY_F3, e.KEY_F4, e.KEY_F5]

PAD_BUTTONS = {
    e.BTN_SOUTH: e.KEY_ENTER, e.BTN_EAST: e.KEY_ESC,
    e.BTN_NORTH: e.KEY_F1, e.BTN_WEST: e.KEY_F3,
    e.BTN_SELECT: e.KEY_F2, e.BTN_START: e.KEY_PLAYPAUSE,
    e.BTN_TL: e.KEY_PREVIOUSSONG, e.BTN_TR: e.KEY_NEXTSONG,
    e.BTN_TL2: e.KEY_VOLUMEDOWN, e.BTN_TR2: e.KEY_VOLUMEUP,
    e.BTN_DPAD_UP: e.KEY_UP, e.BTN_DPAD_DOWN: e.KEY_DOWN,
    e.BTN_DPAD_LEFT: e.KEY_LEFT, e.BTN_DPAD_RIGHT: e.KEY_RIGHT,
}
REPEATING = {e.KEY_UP, e.KEY_DOWN, e.KEY_LEFT, e.KEY_RIGHT, e.KEY_VOLUMEUP, e.KEY_VOLUMEDOWN}

# IR / CEC remotes: kernel keymaps produce these; fold them onto what the UI knows
REMOTE_KEYS = {
    e.KEY_OK: e.KEY_ENTER, e.KEY_SELECT: e.KEY_ENTER, e.KEY_ENTER: e.KEY_ENTER,
    e.KEY_BACK: e.KEY_ESC, e.KEY_EXIT: e.KEY_ESC, e.KEY_ESC: e.KEY_ESC,
    e.KEY_UP: e.KEY_UP, e.KEY_DOWN: e.KEY_DOWN, e.KEY_LEFT: e.KEY_LEFT, e.KEY_RIGHT: e.KEY_RIGHT,
    e.KEY_PLAY: e.KEY_PLAYPAUSE, e.KEY_PAUSE: e.KEY_PLAYPAUSE, e.KEY_PLAYPAUSE: e.KEY_PLAYPAUSE,
    e.KEY_PLAYCD: e.KEY_PLAYPAUSE, e.KEY_PAUSECD: e.KEY_PLAYPAUSE,
    e.KEY_NEXT: e.KEY_NEXTSONG, e.KEY_NEXTSONG: e.KEY_NEXTSONG, e.KEY_FASTFORWARD: e.KEY_NEXTSONG,
    e.KEY_PREVIOUS: e.KEY_PREVIOUSSONG, e.KEY_PREVIOUSSONG: e.KEY_PREVIOUSSONG, e.KEY_REWIND: e.KEY_PREVIOUSSONG,
    e.KEY_STOP: e.KEY_STOPCD, e.KEY_STOPCD: e.KEY_STOPCD,
    e.KEY_VOLUMEUP: e.KEY_VOLUMEUP, e.KEY_VOLUMEDOWN: e.KEY_VOLUMEDOWN,
    e.KEY_MENU: e.KEY_F1, e.KEY_INFO: e.KEY_F1, e.KEY_CONTEXT_MENU: e.KEY_F1,
    e.KEY_HOME: e.KEY_F4, e.KEY_SETUP: e.KEY_F2, e.KEY_SEARCH: e.KEY_F3,
    e.KEY_POWER: e.KEY_F5, e.KEY_SLEEP: e.KEY_F5,
}


def classify(dev):
    """'pad', 'remote' or None (leave it alone)."""
    if dev.name == "musicos-remote":
        return None
    caps = dev.capabilities()
    keys = set(caps.get(e.EV_KEY, []))
    if e.BTN_SOUTH in keys or e.BTN_GAMEPAD in keys:
        return "pad"
    name = dev.name.lower()
    is_keyboard = e.KEY_A in keys and e.KEY_Z in keys
    if not is_keyboard and ("cec" in name or " ir" in name or "remote" in name or "rc-" in name
                            or e.KEY_OK in keys or e.KEY_SELECT in keys):
        return "remote"
    return None


class Output:
    """One virtual keyboard; tracks held keys so it can auto-repeat them."""

    def __init__(self):
        self.ui = UInput({e.EV_KEY: OUT_KEYS}, name="musicos-remote")
        self.held = {}  # key -> (pressed_at, next_repeat_at)

    def tap(self, key):
        self.ui.write(e.EV_KEY, key, 1)
        self.ui.syn()
        self.ui.write(e.EV_KEY, key, 0)
        self.ui.syn()

    def press(self, key):
        if key in self.held:
            return
        self.tap(key)
        if key in REPEATING:
            now = time.monotonic()
            self.held[key] = (now, now + REPEAT_DELAY)

    def release(self, key):
        self.held.pop(key, None)

    async def repeat_loop(self):
        while True:
            now = time.monotonic()
            for key, (since, due) in list(self.held.items()):
                if now >= due:
                    self.tap(key)
                    rate = REPEAT_FAST if now - since > 1.2 else REPEAT_RATE
                    self.held[key] = (since, now + rate)
            await asyncio.sleep(0.02)


class Pad:
    """Gamepad state: d-pad hats, left stick and analog triggers become held keys."""

    def __init__(self, dev, out):
        self.dev, self.out = dev, out
        self.axes = {}
        for code, info in dev.capabilities(absinfo=True).get(e.EV_ABS, []):
            self.axes[code] = info
        self.dir_state = {}  # axis -> -1/0/1

    def _axis_dir(self, code, value):
        info = self.axes.get(code)
        if not info:
            return 0
        if code in (e.ABS_HAT0X, e.ABS_HAT0Y):
            return (value > 0) - (value < 0)
        mid = (info.max + info.min) / 2.0
        span = (info.max - info.min) / 2.0 or 1
        x = (value - mid) / span
        return 1 if x > STICK_THRESHOLD else -1 if x < -STICK_THRESHOLD else 0

    def _set(self, axis, d, neg, pos):
        old = self.dir_state.get(axis, 0)
        if d == old:
            return
        if old:
            self.out.release(pos if old > 0 else neg)
        if d:
            self.out.press(pos if d > 0 else neg)
        self.dir_state[axis] = d

    def handle(self, ev):
        if ev.type == e.EV_KEY and ev.code == e.BTN_MODE:
            # Guide/PS: tap = Home, hold 1 s = power menu
            if ev.value == 1:
                self.guide_down = time.monotonic()
            elif ev.value == 0 and getattr(self, "guide_down", None) is not None:
                held = time.monotonic() - self.guide_down
                self.guide_down = None
                self.out.tap(e.KEY_F5 if held >= 1.0 else e.KEY_F4)
            return
        if ev.type == e.EV_KEY and ev.code in PAD_BUTTONS:
            key = PAD_BUTTONS[ev.code]
            if ev.value == 1:
                self.out.press(key)
            elif ev.value == 0:
                self.out.release(key)
        elif ev.type == e.EV_ABS:
            if ev.code in (e.ABS_HAT0X, e.ABS_X):
                self._set(ev.code, self._axis_dir(ev.code, ev.value), e.KEY_LEFT, e.KEY_RIGHT)
            elif ev.code in (e.ABS_HAT0Y, e.ABS_Y):
                self._set(ev.code, self._axis_dir(ev.code, ev.value), e.KEY_UP, e.KEY_DOWN)
            elif ev.code in (e.ABS_Z, e.ABS_RZ, e.ABS_BRAKE, e.ABS_GAS):
                info = self.axes.get(ev.code)
                if info:  # analog triggers: pressed past half travel
                    pressed = 1 if (ev.value - info.min) > (info.max - info.min) * 0.5 else 0
                    key = e.KEY_VOLUMEDOWN if ev.code in (e.ABS_Z, e.ABS_BRAKE) else e.KEY_VOLUMEUP
                    self._set(ev.code, pressed, key, key)


async def watch(path, kind, out):
    try:
        dev = InputDevice(path)
        dev.grab()  # the browser must not also see the raw events
    except OSError:
        return
    print("musicos-input: %s %s (%s)" % (kind, dev.name, path), flush=True)
    pad = Pad(dev, out) if kind == "pad" else None
    try:
        async for ev in dev.async_read_loop():
            if pad:
                pad.handle(ev)
            elif ev.type == e.EV_KEY and ev.code in REMOTE_KEYS:
                key = REMOTE_KEYS[ev.code]
                if ev.value == 1:
                    out.press(key)
                elif ev.value == 0:
                    out.release(key)
    except OSError:
        pass  # unplugged
    finally:
        for key in list(out.held):
            out.release(key)
        print("musicos-input: gone %s" % path, flush=True)


async def main():
    out = Output()
    asyncio.ensure_future(out.repeat_loop())
    watching = {}
    while True:  # hot-plug: rescan every 2 s (USB pads, Bluetooth pads, HDMI-CEC appearing)
        for path in list_devices():
            if path in watching and not watching[path].done():
                continue
            try:
                kind = classify(InputDevice(path))
            except OSError:
                continue
            if kind:
                watching[path] = asyncio.ensure_future(watch(path, kind, out))
        await asyncio.sleep(2)


if __name__ == "__main__":
    if not os.path.exists("/dev/uinput"):
        os.system("modprobe uinput")
    asyncio.run(main())
