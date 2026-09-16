"""OpenStreetMap: Nominatim to find the place, Overpass to list the businesses in it. No key."""
import requests

from ..config import TOOL_UA
from ..http import Throttle, get

_nominatim = Throttle(1.1)  # usage policy: max 1 request per second
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
TAG_KEYS = ("healthcare", "amenity", "tourism", "shop", "office", "craft", "leisure")


def geocode(location: str, country: str) -> dict | None:
    with _nominatim:
        r = get("https://nominatim.openstreetmap.org/search",
                params={"q": location, "countrycodes": country.lower(), "format": "jsonv2", "limit": 1},
                headers={"User-Agent": TOOL_UA}, timeout=20)
    r.raise_for_status()
    data = r.json()
    if not data:
        return None
    d = data[0]
    return {"name": d.get("name") or location, "display": d["display_name"], "lat": float(d["lat"]),
            "lon": float(d["lon"]), "osm_type": d["osm_type"], "osm_id": int(d["osm_id"])}


def overpass(query: str) -> list[dict]:
    last = ""
    for url in ENDPOINTS:
        try:
            r = requests.post(url, data={"data": query}, headers={"User-Agent": TOOL_UA}, timeout=120)
            if r.status_code == 200:
                return r.json().get("elements", [])
            last = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            last = type(e).__name__
    raise RuntimeError(f"OpenStreetMap search failed on every server ({last})")


def find(filters: list[str], place: dict, limit: int) -> list[dict]:
    if place["osm_type"] in ("relation", "way"):
        area = (3600000000 if place["osm_type"] == "relation" else 2400000000) + place["osm_id"]
        head, scope = f"area({area})->.a;", "(area.a)"
    else:
        head, scope = "", f"(around:12000,{place['lat']},{place['lon']})"
    body = "".join(f"{f}{scope};" for f in filters)
    elements = overpass(f"[out:json][timeout:100];{head}({body});out center tags {max(80, limit * 4)};")

    out = []
    for e in elements:
        t = e.get("tags", {})
        name = t.get("name")
        if not name:
            continue

        def split(*keys):
            return [x.strip() for k in keys for x in (t.get(k) or "").split(";") if x.strip()]

        out.append({
            "key": f"osm:{e['type']}/{e['id']}",
            "name": name,
            "category": next((t[k] for k in TAG_KEYS if k in t), "").replace("_", " "),
            "lat": e.get("lat") or e.get("center", {}).get("lat"),
            "lon": e.get("lon") or e.get("center", {}).get("lon"),
            "phones": split("phone", "contact:phone", "contact:mobile", "mobile"),
            "emails": split("email", "contact:email"),
            "website": (split("website", "contact:website", "url") or [""])[0],
            "address": " ".join(x for x in (t.get("addr:housenumber", ""), t.get("addr:street", "")) if x),
            "postcode": t.get("addr:postcode", ""),
            "city": t.get("addr:city", "") or place["name"],
            "socials": {k.split(":")[1]: t[k] for k in ("contact:facebook", "contact:instagram") if t.get(k)},
            "maps": {"hours": t["opening_hours"]} if t.get("opening_hours") else {},
            "sources": ["OpenStreetMap"],
        })
    return out
