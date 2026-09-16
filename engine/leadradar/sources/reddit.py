"""Official Reddit API (app-only OAuth). Needs a free 'script' app's client ID and secret."""
import threading
import time

import requests

from ..config import secret
from ..http import Blocked, NeedsKey

UA = "windows:lead-radar:0.1 (local prospecting tool)"
_token = {"value": "", "exp": 0.0}
_lock = threading.Lock()


def available() -> bool:
    return bool(secret("REDDIT_CLIENT_ID") and secret("REDDIT_CLIENT_SECRET"))


def _auth() -> str:
    cid, sec = secret("REDDIT_CLIENT_ID"), secret("REDDIT_CLIENT_SECRET")
    if not cid or not sec:
        raise NeedsKey("Add your Reddit app ID and secret in Settings")
    with _lock:
        if _token["value"] and _token["exp"] > time.time() + 60:
            return _token["value"]
        r = requests.post("https://www.reddit.com/api/v1/access_token", auth=(cid, sec),
                          data={"grant_type": "client_credentials"}, headers={"User-Agent": UA}, timeout=20)
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code in (401, 403) or "access_token" not in body:
            raise Blocked("Reddit rejected the app ID/secret")
        _token.update(value=body["access_token"], exp=time.time() + body.get("expires_in", 3600))
        return _token["value"]


def search(query: str, limit: int = 12) -> list[dict]:
    token = _auth()
    r = requests.get("https://oauth.reddit.com/search", params={"q": query, "limit": limit, "sort": "relevance", "t": "year", "type": "link"},
                     headers={"Authorization": f"Bearer {token}", "User-Agent": UA}, timeout=20)
    if r.status_code == 429:
        raise Blocked("Reddit rate limit")
    r.raise_for_status()
    out = []
    for child in r.json().get("data", {}).get("children", []):
        d = child.get("data", {})
        out.append({"title": d.get("title", ""), "url": "https://www.reddit.com" + d.get("permalink", ""),
                    "snippet": (d.get("selftext") or "")[:200], "subreddit": d.get("subreddit", ""),
                    "comments": d.get("num_comments", 0)})
    return out
