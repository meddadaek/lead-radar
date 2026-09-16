"""The exclusion list: every business from past campaigns, reduced to matching keys."""
import copy
import importlib.util
import re
import threading
import unicodedata
from collections import Counter
from urllib.parse import urlparse

from .config import IMPORTER

FREEMAIL = re.compile(
    r"^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|aol|gmx|yandex|proton|protonmail|"
    r"orange|free|wanadoo|sfr|laposte|neuf|bbox|numericable|web|t-online|libero|virgilio|mail)\.", re.I)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def host_of(url_or_email: str) -> str:
    s = (url_or_email or "").strip().lower()
    if "@" in s and "/" not in s:
        s = s.split("@", 1)[1]
    elif s:
        s = urlparse(s if "//" in s else "http://" + s).hostname or ""
    return s[4:] if s.startswith("www.") else s


def keys_for(email="", website="", phones=(), name="", city="", other_emails=()) -> set[str]:
    keys = set()
    for e in [email, *other_emails]:
        if e and "@" in e:
            keys.add("e:" + e.strip().lower())
            d = host_of(e)
            if d and not FREEMAIL.match(d):
                keys.add("d:" + d)
    h = host_of(website)
    if h and not re.search(r"facebook|instagram|google|wix|linktr|business\.site", h):
        keys.add("d:" + h)
    for p in phones:
        digits = re.sub(r"\D", "", p or "")
        if len(digits) >= 8:
            keys.add("p:" + digits[-9:])
    if name and city:
        keys.add("n:" + norm(name) + "|" + norm(city))
    return keys


_cache: dict = {}
_lock = threading.Lock()


def archive() -> dict:
    """Load the past-campaign files once. Returns {keys, businesses, files}."""
    with _lock:
        if _cache:
            return _cache
        spec = importlib.util.spec_from_file_location("import_existing", IMPORTER)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        raw = mod.load_all()
        keys = set()
        for l in raw:
            keys |= keys_for(l["email"], l["website"], l["phones"] + [l["whatsapp"]], l["name"], l["city"], l["other_emails"])
        # send logs that are not already part of a lead file
        for f in ("dz_sent_0911.csv", "alger_cars_sent_0913.csv", "outbox_fr.csv"):
            for r in mod.rows(f):
                keys |= keys_for(email=(r.get("email") or ""))
        for r in mod.rows("dz_whatsapp_sent_0911.csv"):
            keys |= keys_for(phones=[r.get("whatsapp") or ""])
        businesses = len(mod.merge(copy.deepcopy(raw)))
        files = Counter(d for l in raw for d in l["datasets"])
        _cache.update(keys=keys, businesses=businesses, files=[{"file": f + ".csv", "rows": n} for f, n in files.most_common()])
        return _cache
