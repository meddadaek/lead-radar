import threading
import time

import requests

from .config import BROWSER_UA

HEADERS = {
    "User-Agent": BROWSER_UA,
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
}


class Blocked(Exception):
    """The source answered, but refused us (captcha, login wall, 403)."""


class NeedsKey(Exception):
    """The source needs a key the user has not added to engine/.env."""


def get(url, **kw):
    kw.setdefault("timeout", 15)
    headers = {**HEADERS, **kw.pop("headers", {})}
    return requests.get(url, headers=headers, **kw)


class Throttle:
    """Serialize calls to one host and keep a minimum gap between them."""

    def __init__(self, gap: float):
        self.gap = gap
        self.lock = threading.Lock()
        self.last = 0.0

    def __enter__(self):
        self.lock.acquire()
        wait = self.last + self.gap - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        return self

    def __exit__(self, *exc):
        self.last = time.monotonic()
        self.lock.release()
