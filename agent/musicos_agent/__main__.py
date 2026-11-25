import argparse
import os

from .folder import FolderClient
from .mock import MockClient
from .mpd import MPDClient
from .server import serve

DEFAULT_UI = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "ui", "dist")


def main():
    p = argparse.ArgumentParser(prog="musicos-agent")
    p.add_argument("--host", default=os.environ.get("MUSICOS_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("MUSICOS_PORT", 8080)))
    p.add_argument("--ui", default=os.environ.get("MUSICOS_UI", DEFAULT_UI))
    p.add_argument("--music-root", default=os.environ.get("MUSICOS_MUSIC_ROOT", "/srv/music"),
                   help="MPD music_directory, used to read cover images")
    p.add_argument("--mpd-host", default=os.environ.get("MPD_HOST", "127.0.0.1"))
    p.add_argument("--mpd-port", type=int, default=int(os.environ.get("MPD_PORT", 6600)))
    g = p.add_mutually_exclusive_group()
    g.add_argument("--mock", action="store_true", help="tiny fake library, no MPD needed")
    g.add_argument("--library", help="dev: read an Artist/YYYY - Album tree directly, no MPD")
    a = p.parse_args()
    if a.library:
        client, root = FolderClient(a.library), a.library
    elif a.mock:
        client, root = MockClient(), a.music_root
    else:
        client, root = MPDClient(a.mpd_host, a.mpd_port), a.music_root
    serve(client, a.ui, a.host, a.port, root)


if __name__ == "__main__":
    main()
