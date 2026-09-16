"""Enrichment and discovery sources beyond OpenStreetMap and Google Maps.

Every function either returns data, returns None/[] when the business simply
isn't there, or raises Blocked / NeedsKey so the UI can say *why* a source gave
nothing. Nothing here logs in anywhere or needs a card.
"""
import json
import re
import urllib.parse

import requests

from ..config import secret
from ..http import Blocked, NeedsKey, Throttle, get
from ..known import host_of, norm
from . import reddit, websearch
from .browser import browser

_registry = Throttle(0.25)


def _mentions(name: str, *texts: str) -> bool:
    tokens = [t for t in norm(name).split() if len(t) >= 4] or norm(name).split()
    hay = norm(" ".join(texts))
    return bool(tokens) and sum(t in hay for t in tokens) >= min(2, len(tokens))


# ---------------------------------------------------------------- company registry (France)

def company_registry(name: str, country: str, postcode: str = "", city: str = "") -> dict | None:
    if country.upper() != "FR":
        return None
    params = {"q": name, "per_page": 5}
    if postcode:
        params["code_postal"] = postcode
    with _registry:
        r = get("https://recherche-entreprises.api.gouv.fr/search", params=params, headers={"Accept": "application/json"})
    if r.status_code == 429:
        raise Blocked("registry rate limit")
    if r.status_code != 200:
        return None
    for x in r.json().get("results", []):
        siege = x.get("siege") or {}
        signs = " ".join(m.get("nom_enseigne") or "" for m in x.get("matching_etablissements") or [])
        if not _mentions(name, x.get("nom_complet") or "", x.get("nom_raison_sociale") or "", signs):
            continue
        if city and not postcode and norm(city) not in norm(siege.get("libelle_commune") or ""):
            continue
        directors = []
        for d in x.get("dirigeants") or []:
            if d.get("type_dirigeant") == "personne physique":
                who = f"{(d.get('prenoms') or '').split(' ')[0].title()} {(d.get('nom') or '').title()}".strip()
                directors.append(f"{who} ({d['qualite']})" if d.get("qualite") else who)
        return {"siren": x.get("siren"), "legal_name": x.get("nom_complet"), "created": x.get("date_creation"),
                "staff": x.get("tranche_effectif_salarie"), "activity": x.get("activite_principale"),
                "directors": directors[:3]}
    return None


# ---------------------------------------------------------------- domain history

def domain_history(website: str) -> dict | None:
    host = host_of(website)
    if not host:
        return None
    out: dict = {"domain": host}
    try:
        r = get(f"https://rdap.org/domain/{host}", headers={"Accept": "application/rdap+json"}, timeout=25)
        if r.status_code == 200:
            for e in r.json().get("events", []):
                if e.get("eventAction") == "registration":
                    out["registered"] = e.get("eventDate")
    except (requests.RequestException, ValueError):
        pass
    for _ in range(1):  # the Wayback Machine is often slow; treat it as a bonus
        try:
            r = get("https://web.archive.org/cdx/search/cdx", params={"url": host, "output": "json", "limit": 1, "fl": "timestamp"}, timeout=10)
            if r.status_code == 200:
                rows = r.json()
                if len(rows) > 1:
                    out["first_archived"] = rows[1][0][:8]
                break
        except (requests.RequestException, ValueError):
            continue
    return out if len(out) > 1 else None


# ---------------------------------------------------------------- social profiles + people (via web search, no login)

PROFILE = {
    # only the profile root, never a post, video or photo
    "facebook": re.compile(r"^(https?://(?:[a-z]+\.)?facebook\.com/(?!sharer|share|dialog|events|groups|watch|photo|reel|story|people|pages/category)[A-Za-z0-9.\-_%]+)/?(?:$|\?|#|videos|posts|photos|about|reviews)", re.I),
    "instagram": re.compile(r"^(https?://(?:www\.)?instagram\.com/(?!p/|reel/|reels/|explore|stories)[A-Za-z0-9._]+)/?(?:$|\?)", re.I),
    "tiktok": re.compile(r"^(https?://(?:www\.)?tiktok\.com/@[A-Za-z0-9._]+)/?(?:$|\?)", re.I),
    "linkedin": re.compile(r"^(https?://(?:[a-z]{2,3}\.)?linkedin\.com/company/[^/?#]+)", re.I),
}
SOCIAL_DOMAINS = {"facebook": "facebook.com", "instagram": "instagram.com", "tiktok": "tiktok.com", "linkedin": "linkedin.com"}


def social_profiles(name: str, city: str, country: str, wanted: list[str] | None = None) -> dict:
    """Profiles on Facebook / Instagram / TikTok / LinkedIn whose result mentions the business."""
    keys = wanted or list(PROFILE)
    found: dict = {}
    for res in websearch.search(f"{name} {city}", country, 15, domains=[SOCIAL_DOMAINS[k] for k in keys]):
        for key in keys:
            m = PROFILE[key].match(res["url"])
            if key not in found and m and _mentions(name, res["title"], res["snippet"]):
                found[key] = m.group(1)
                if key == "instagram":
                    found["instagram_snippet"] = res["title"] + " " + res["snippet"]
    return found


DECISION = re.compile(r"owner|founder|ceo|director|directeur|directrice|g[ée]rant|manager|pr[ée]sident|partner|associ|"
                      r"dr\b|docteur|chirurgien|dentist|m[ée]decin|propri[ée]taire", re.I)


def linkedin_people(company: str, city: str, country: str) -> list[dict]:
    people = []
    for res in websearch.search(f"{company} {city}", country, 12, domains=["linkedin.com"]):
        if "linkedin.com/in/" not in res["url"] or not _mentions(company, res["title"], res["snippet"]):
            continue
        title = re.sub(r"\s*[|·]\s*LinkedIn.*$", "", res["title"])
        parts = [p.strip() for p in re.split(r"\s+[-–—]\s+", title) if p.strip()]
        if parts:
            people.append({"name": parts[0], "title": parts[1] if len(parts) > 1 else "", "url": res["url"].split("?")[0], "via": "LinkedIn"})
    people.sort(key=lambda p: 0 if DECISION.search(p["title"]) else 1)
    return people[:3]


def doctolib(name: str, city: str, country: str) -> str | None:
    domain = {"FR": "doctolib.fr", "DE": "doctolib.de", "IT": "doctolib.it"}.get(country.upper())
    if not domain:
        return None
    for res in websearch.search(f"{name} {city}", country, 6, domains=[domain]):
        if domain in res["url"] and _mentions(name, res["title"], res["snippet"]):
            return res["url"].split("?")[0]
    return None


def reddit_intent(niche: str, location: str, country: str) -> list[dict]:
    """Posts where people ask for this kind of business: official Reddit API if keys are set, else web search."""
    if reddit.available():
        posts = reddit.search(f"{niche} {location}".strip()) + reddit.search(f"{niche} recommend")
        seen, out = set(), []
        for p in posts:
            if p["url"] not in seen:
                seen.add(p["url"])
                out.append(p)
        return out[:8]
    return [{"title": r["title"], "url": r["url"], "snippet": r["snippet"][:200]}
            for r in websearch.search(f"{niche} {location} recommend looking for", country, 10, domains=["reddit.com"])
            if "/r/" in r["url"]][:6]


# ---------------------------------------------------------------- directories

def pagesjaunes(niche: str, location: str) -> list[dict]:
    r = get("https://www.pagesjaunes.fr/annuaire/chercherlespros", params={"quoiqui": niche, "ou": location}, timeout=20)
    if r.status_code in (403, 429):
        raise Blocked(f"PagesJaunes answered {r.status_code}")
    names = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", n)).strip()
             for n in re.findall(r'class="[^"]*bi-denomination[^"]*"[^>]*>(.*?)</(?:a|h3|div)>', r.text, re.S)]
    addresses = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", a)).replace("Voir le plan", "").strip()
                 for a in re.findall(r'class="[^"]*bi-address[^"]*"[^>]*>(.*?)</(?:a|div)>', r.text, re.S)]
    if not names and "captcha-delivery" in r.text:
        raise Blocked("PagesJaunes showed a captcha")
    return [{"key": "pj:" + norm(n), "name": n, "category": niche, "lat": None, "lon": None, "phones": [], "emails": [],
             "website": "", "address": addresses[i] if i < len(addresses) else "", "postcode": "", "city": "",
             "socials": {}, "maps": {}, "sources": ["Directories"]} for i, n in enumerate(names) if n]


def yellowpages(niche: str, location: str) -> list[dict]:
    def job(page):
        url = "https://www.yellowpages.com/search?" + urllib.parse.urlencode({"search_terms": niche, "geo_location_terms": location})
        resp = page.goto(url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(2500)
        if (resp and resp.status in (403, 429)) or page.locator("text=Verify you are human").count():
            raise Blocked("Yellow Pages showed a bot check")
        out = []
        for card in page.locator("div.result").all()[:40]:
            name = card.locator("a.business-name").first
            if not name.count():
                continue
            phone = card.locator("div.phones").first
            site = card.locator("a.track-visit-website").first
            street = card.locator("div.street-address").first
            out.append({"key": "yp:" + norm(name.inner_text()), "name": name.inner_text().strip(), "category": niche,
                        "lat": None, "lon": None, "phones": [phone.inner_text().strip()] if phone.count() else [],
                        "emails": [], "website": site.get_attribute("href") if site.count() else "",
                        "address": street.inner_text().strip() if street.count() else "", "postcode": "", "city": "",
                        "socials": {}, "maps": {}, "sources": ["Directories"]})
        return out

    return browser.run(job, timeout=90)


def directory(niche: str, location: str, country: str) -> list[dict]:
    cc = country.upper()
    if cc == "FR":
        return pagesjaunes(niche, location)
    if cc in ("US", "CA"):
        return yellowpages(niche, location)
    return []


# ---------------------------------------------------------------- Meta Ad Library (headless browser, no login)

def meta_ads(name: str, country: str) -> dict | None:
    url = ("https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=" + country.upper()
           + "&q=" + urllib.parse.quote(f'"{name}"') + "&search_type=keyword_exact_phrase&media_type=all")

    def job(page):
        page.goto(url, wait_until="commit", timeout=60000)
        try:
            page.wait_for_selector("text=/results?|No ads match|Ad Library/i", timeout=35000)
        except Exception as e:  # noqa: BLE001
            raise Blocked("Meta Ad Library did not load (slow or blocked)") from e
        for label in ("Decline optional cookies", "Only allow essential cookies", "Refuser les cookies optionnels"):
            b = page.get_by_role("button", name=label)
            if b.count():
                b.first.click()
                break
        page.wait_for_timeout(6000)
        body = page.inner_text("body")
        low = body.lower()
        if "ad library" not in low and "log in" in low:
            raise Blocked("Meta asked to log in")
        m = re.search(r"~?\s*([\d,.\s]+)\s*(K|M)?\s+results?", body)
        if m:
            n = int(re.sub(r"\D", "", m.group(1)) or 0) * {"K": 1000, "M": 1_000_000}.get(m.group(2) or "", 1)
            return {"count": n, "url": url}
        if re.search(r"no ads match|0 results", low):
            return {"count": 0, "url": url}
        return None

    return browser.run(job, timeout=90)


# ---------------------------------------------------------------- Trustpilot (headless browser)

def trustpilot(website: str) -> dict | None:
    host = host_of(website)
    if not host:
        return None

    def job(page):
        resp = page.goto(f"https://www.trustpilot.com/review/{host}", wait_until="domcontentloaded", timeout=40000)
        if resp is not None and resp.status == 404:
            return None
        raw = page.evaluate("() => document.getElementById('__NEXT_DATA__')?.textContent || null")
        if not raw:
            if resp is not None and resp.status in (403, 429):
                raise Blocked(f"Trustpilot answered {resp.status}")
            return None
        props = json.loads(raw).get("props", {}).get("pageProps", {})
        unit = props.get("businessUnit") or {}
        if not unit:
            return None
        reviews = props.get("reviews") or []
        return {
            "url": page.url, "score": unit.get("trustScore"), "reviews": unit.get("numberOfReviews"),
            "complaints": [f"{r.get('title') or ''}: {(r.get('text') or '')[:180]}".strip(": ")
                           for r in reviews if (r.get("rating") or 5) <= 2][:3],
        }

    try:
        return browser.run(job, timeout=70)
    except Blocked:
        # Trustpilot blocks headless browsers; its search snippet still carries the score and review count.
        for res in websearch.search(f"{host} reviews", "", 5, domains=["trustpilot.com"]):
            if host.split(".")[0] in res["url"].lower():
                text = res["title"] + " " + res["snippet"]
                score = re.search(r"TrustScore\s*(?:of\s*)?(\d(?:[.,]\d)?)", text, re.I)
                count = re.search(r"([\d,.\s]+)\s*(?:reviews|avis)", text, re.I)
                return {"url": res["url"], "score": float(score.group(1).replace(",", ".")) if score else None,
                        "reviews": int(re.sub(r"\D", "", count.group(1)) or 0) if count else None,
                        "complaints": [], "via": "search snippet"}
        return None


# ---------------------------------------------------------------- Apollo (needs the user's own API key)

def apollo(domain: str) -> list[dict]:
    key = secret("APOLLO_API_KEY")
    if not key:
        raise NeedsKey("Add APOLLO_API_KEY=... to lead-radar/engine/.env")
    r = requests.post(
        "https://api.apollo.io/api/v1/mixed_people/api_search",
        json={"q_organization_domains_list": [domain], "person_titles": ["owner", "founder", "ceo", "director", "manager"], "per_page": 3},
        headers={"X-Api-Key": key, "Content-Type": "application/json", "Cache-Control": "no-cache"}, timeout=20)
    if r.status_code in (401, 403, 422):
        raise Blocked(f"Apollo refused the request ({r.status_code})")
    if r.status_code != 200:
        return []
    return [{"name": p.get("name") or " ".join(x for x in (p.get("first_name"), p.get("last_name")) if x),
             "title": p.get("title") or "", "url": p.get("linkedin_url") or "", "via": "Apollo"}
            for p in r.json().get("people", [])]
