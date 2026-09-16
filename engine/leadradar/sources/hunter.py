"""Hunter domain search: published email addresses for a company domain (free plan, no card)."""
import requests

from ..config import secret
from ..http import Blocked, NeedsKey


def domain_search(domain: str, limit: int = 10) -> dict:
    key = secret("HUNTER_API_KEY")
    if not key:
        raise NeedsKey("Add your Hunter key in Settings")
    r = requests.get("https://api.hunter.io/v2/domain-search", params={"domain": domain, "limit": limit, "api_key": key}, timeout=25)
    if r.status_code in (401, 403):
        raise Blocked("Hunter rejected the key")
    if r.status_code == 429:
        raise Blocked("Hunter monthly limit reached")
    r.raise_for_status()
    d = r.json().get("data") or {}
    return {
        "pattern": d.get("pattern"),
        "organization": d.get("organization"),
        "emails": [{
            "address": (e.get("value") or "").lower(),
            "confidence": e.get("confidence"),
            "name": " ".join(x for x in (e.get("first_name"), e.get("last_name")) if x),
            "position": e.get("position") or "",
            "sources": [s.get("uri") for s in (e.get("sources") or [])[:2] if s.get("uri")],
        } for e in d.get("emails", []) if e.get("value")],
    }
