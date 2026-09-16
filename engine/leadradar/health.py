"""Live self-test of every source against a real, public sample. Results are stored for the UI."""
import threading
import uuid

from . import db
from .enrich import crawl
from .http import Blocked, NeedsKey
from . import llm
from .sources import gmaps, hunter, instagram, osm, tavily, web, websearch
from .verify import verify_email

_thread: threading.Thread | None = None


def _osm():
    place = osm.geocode("Lyon", "FR")
    items = osm.find(['nwr["amenity"="dentist"]'], place, 10)
    return ("ok", f"{len(items)} dentists found in Lyon") if items else ("error", "No results for dentists in Lyon")


def _gmaps():
    urls = gmaps.search("dentiste Lyon", 3)
    if not urls:
        return "error", "No places returned"
    d = gmaps.details(urls[:1])
    if not d or not d[0]["name"]:
        return "partial", "Places listed, but the detail page could not be read"
    x = d[0]
    return "ok", f"{x['name']} · ★{x['maps'].get('rating', '–')} · {x['phones'][0] if x['phones'] else 'no phone'}"


def _directories():
    notes, ok = [], 0
    for label, fn, args in (("PagesJaunes", web.pagesjaunes, ("dentiste", "Lyon")), ("Yellow Pages", web.yellowpages, ("dentist", "Austin, TX"))):
        try:
            n = len(fn(*args))
            ok += n > 0
            notes.append(f"{label}: {n} listings")
        except Blocked as e:
            notes.append(f"{label}: blocked ({e})")
    return ("ok" if ok == 2 else "partial" if ok else "blocked"), " · ".join(notes)


def _registry():
    r = web.company_registry("Doctolib", "FR")
    return ("ok", f"{r['legal_name']} · SIREN {r['siren']} · {len(r['directors'])} directors") if r else ("error", "No match")


def _doctolib():
    n = len([r for r in websearch.search("site:doctolib.fr dentiste lyon", "FR", 8) if "doctolib.fr" in r["url"]])
    return ("ok", f"{n} Doctolib listings found through web search") if n else ("error", "No Doctolib listings found")


def _websearch():
    res = websearch.search("Centre Dentaire Maréchal Foch Grenoble", "FR", 8)
    relevant = [r for r in res if "dentaire" in (r["url"] + r["title"]).lower()]
    engine = websearch.engine_name()
    if not res:
        return ("error" if tavily.available() else "blocked"), f"{engine} returned nothing" + ("" if tavily.available() else " · add a Tavily key in Settings")
    return ("ok" if relevant else "partial"), f"{engine}: {len(res)} results, {len(relevant)} relevant"


def _hunter():
    r = hunter.domain_search("doctolib.fr", 5)
    return ("ok", f"{len(r['emails'])} emails · pattern {r['pattern'] or 'unknown'}") if r["emails"] else ("partial", "Key accepted, no emails returned")


def _agent():
    reply = llm.chat([{"role": "user", "content": "Reply with the single word READY."}], max_tokens=5)
    text = (reply.get("content") or "").strip()
    return ("ok", f"{llm.model()} answered “{text[:20]}”") if text else ("error", "Model returned an empty reply")


def _instagram():
    try:
        p = instagram.profile("doctolib")
        if p:
            return "ok", f"@{p['username']} · {p['followers']:,} followers · {p['posts']:,} posts (no login)"
    except Blocked as e:
        found = web.social_profiles("Doctolib", "Paris", "FR", ["instagram"])
        if found.get("instagram"):
            followers = instagram.stats_from_snippet(found.get("instagram_snippet", "")).get("followers")
            count = f" · {followers:,} followers" if followers else ""
            return "partial", f"Profile found via search{count} · direct read blocked ({e})"
        raise
    return "error", "Profile not found"


def _crawl():
    s = crawl("https://www.python.org", "US")
    if not s["reachable"]:
        return "error", "Test site unreachable"
    return "ok", f"{len(s['emails'])} emails, {len(s['phones'])} phones, {len(s['socials'])} social links read"


def _audit():
    s = crawl("https://www.python.org", "US")
    return ("ok", f"mobile={s['mobile']} https={s['https']} load={s['load_ms']}ms") if s["reachable"] else ("error", "Test site unreachable")


def _domain():
    d = web.domain_history("https://python.org")
    if not d:
        return "error", "No registration or archive data"
    return ("ok" if d.get("registered") and d.get("first_archived") else "partial"), \
        f"registered {d.get('registered', '?')[:10]} · first archived {d.get('first_archived', 'unavailable')}"


def _linkedin():
    people = web.linkedin_people("Doctolib", "Paris", "FR")
    return ("ok", f"{len(people)} people · e.g. {people[0]['name']} ({people[0]['title'][:40]})") if people else ("error", "No profiles found")


def _social(key):
    def test():
        found = web.social_profiles("Doctolib", "Paris", "FR")
        return ("ok", f"Profile found: {found[key]}") if key in found else ("error", "Profile not found for the test business")
    return test


def _reddit():
    from .sources import reddit
    posts = web.reddit_intent("dentist", "", "US")
    via = "official API" if reddit.available() else websearch.engine_name()
    return ("ok", f"{len(posts)} posts via {via} · {posts[0]['title'][:60]}") if posts else ("error", f"No posts found via {via}")


def _ads():
    r = web.meta_ads("Doctolib", "FR")
    return ("ok", f"{r['count']} active ads found for the test advertiser") if r is not None else ("error", "Could not read the result count")


def _trustpilot():
    r = web.trustpilot("https://www.amazon.com")
    if not r:
        return "error", "No Trustpilot data read"
    via = " (from search snippet; page blocks bots)" if r.get("via") else ""
    return ("partial" if via else "ok"), f"TrustScore {r['score']} · {r['reviews'] or 0:,} reviews{via}"


def _apollo():
    people = web.apollo("doctolib.fr")
    return ("ok", f"{len(people)} people returned") if people else ("partial", "Key accepted, no people returned")


def _email():
    v = verify_email(f"lr-selftest-{uuid.uuid4().hex[:10]}@gmail.com")
    if v["smtp"] is None:
        return "error", "Could not reach mail servers on port 25"
    return "ok", f"Mail server answered ({v['smtp']}): fake address correctly rejected" if v["verdict"] == "invalid" else f"Mail server answered {v['smtp']}"


TESTS = {
    "OpenStreetMap": _osm, "Google Maps": _gmaps, "Directories": _directories, "Company registry": _registry,
    "Doctolib": _doctolib, "Web search": _websearch, "Website crawl": _crawl, "Website audit": _audit,
    "Domain history": _domain, "LinkedIn": _linkedin, "Apollo": _apollo, "Facebook": _social("facebook"),
    "Instagram": _instagram, "TikTok": _social("tiktok"), "Reddit": _reddit,
    "Meta Ad Library": _ads, "Trustpilot": _trustpilot, "Email check": _email, "Hunter": _hunter, "AI agent": _agent,
}


def run_all(only: list[str] | None = None):
    for name, fn in TESTS.items():
        if only and name not in only:
            continue
        db.set_health(name, "testing", "Running live test…")
        try:
            status, detail = fn()
        except NeedsKey as e:
            status, detail = "needs_key", str(e)
        except Blocked as e:
            status, detail = "blocked", str(e)
        except Exception as e:  # noqa: BLE001
            status, detail = "error", f"{type(e).__name__}: {str(e)[:200]}"
        db.set_health(name, status, detail)


def is_running() -> bool:
    return bool(_thread and _thread.is_alive())


def start(only: list[str] | None = None) -> bool:
    global _thread
    if is_running():
        return False
    _thread = threading.Thread(target=run_all, args=(only,), name="source-health", daemon=True)
    _thread.start()
    return True
