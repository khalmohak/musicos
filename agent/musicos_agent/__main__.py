import argparse
import os

from .mock import MockClient
from .mpd import MPDClient
from .server import serve

DEFAULT_UI = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "ui")


def main():
    p = argparse.ArgumentParser(prog="musicos-agent")
    p.add_argument("--host", default=os.environ.get("MUSICOS_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("MUSICOS_PORT", 8080)))
    p.add_argument("--ui", default=os.environ.get("MUSICOS_UI", DEFAULT_UI))
    p.add_argument("--mpd-host", default=os.environ.get("MPD_HOST", "127.0.0.1"))
    p.add_argument("--mpd-port", type=int, default=int(os.environ.get("MPD_PORT", 6600)))
    p.add_argument("--mock", action="store_true", help="fake library, no MPD needed")
    a = p.parse_args()
    client = MockClient() if a.mock else MPDClient(a.mpd_host, a.mpd_port)
    serve(client, a.ui, a.host, a.port)


if __name__ == "__main__":
    main()
