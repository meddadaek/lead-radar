"""One search run: discover -> exclude known -> find website -> crawl -> confirm contacts -> enrich -> score -> save."""
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from . import agent, db, llm, niches
from .enrich import crawl, site_matches
from .http import Blocked, NeedsKey
from .known import FREEMAIL, archive, host_of, keys_for, norm
from .score import score
from .sources import gmaps, hunter, instagram, osm, web, websearch
from .verify import verify_email, verify_phone

NOT_A_WEBSITE = re.compile(
    r"facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|pagesjaunes|doctolib|yelp|tripadvisor|google\.|bing\.|"
    r"wikipedia|annuaire|118712|societe\.com|pappers|mappy|justacote|booking\.com|expedia|hotels\.com|trivago|airbnb|"
    r"infobel|cylex|yellowpages|foursquare|waze|apple\.com|leboncoin|indeed|glassdoor|planity|treatwell|kompass|"
    r"verif\.com|manageo|bottin|petitfute|thefork|lafourchette|ubereats|deliveroo|reddit|pinterest|linktr\.ee|wa\.me", re.I)
EMAIL_WORD = {"valid": "email verified", "risky": "email unconfirmable", "invalid": "email bounces", "none": "no email", "unknown": "email unchecked"}

_running: dict[str, threading.Thread] = {}


def running() -> list[str]:
    return [sid for sid, t in _running.items() if t.is_alive()]


def start(sid: str) -> bool:
    t = _running.get(sid)
    if t and t.is_alive():
        return False
    search = db.get_search(sid)
    if not search:
        return False

    def target():
        try:
            Run(sid, search["params"]).run()
        except Exception as e:  # noqa: BLE001 - surface any failure in the UI
            db.log(sid, "error", f"Search stopped: {e}")
            db.update_search(sid, state="error", last_error=str(e)[:300])
        finally:
            _running.pop(sid, None)

    t = threading.Thread(target=target, name=f"search-{sid}", daemon=True)
    _running[sid] = t
    t.start()
    return True


def merge_candidates(items: list[dict]) -> list[dict]:
    """The same business from OpenStreetMap, Google Maps and a directory becomes one candidate."""
    out: list[dict] = []
    index: dict[str, dict] = {}
    for c in items:
        keys = {"p:" + re.sub(r"\D", "", p)[-9:] for p in c["phones"] if len(re.sub(r"\D", "", p)) >= 8}
        keys.add("n:" + norm(c["name"]))
        if host_of(c["website"]) and not NOT_A_WEBSITE.search(host_of(c["website"])):
            keys.add("d:" + host_of(c["website"]))
        hit = next((index[k] for k in keys if k in index), None)
        if hit is None:
            hit = {**c, "phones": list(c["phones"]), "emails": list(c["emails"]), "sources": list(c["sources"]),
                   "maps": dict(c.get("maps") or {}), "socials": dict(c.get("socials") or {})}
            out.append(hit)
        else:
            hit["phones"] = list(dict.fromkeys(hit["phones"] + c["phones"]))
            hit["emails"] = list(dict.fromkeys(hit["emails"] + c["emails"]))
            hit["sources"] = list(dict.fromkeys(hit["sources"] + c["sources"]))
            hit["maps"] = {**(c.get("maps") or {}), **hit["maps"]}
            hit["socials"] = {**(c.get("socials") or {}), **hit["socials"]}
            for f in ("website", "address", "postcode", "category", "lat", "lon"):
                hit[f] = hit.get(f) or c.get(f)
        for k in keys:
            index[k] = hit
    return out


class Run:
    def __init__(self, sid: str, params: dict):
        self.sid = sid
        self.p = params
        self.cc = params["country"].upper()
        self.src = set(params.get("sources") or [])
        self.lock = threading.Lock()
        self.progress = {"step": "starting", "pct": 0, "found": 0, "known": 0, "already": 0, "total": 0, "checked": 0,
                         "saved": 0, "new": 0, "no_contact": 0, "emails_valid": 0, "emails_risky": 0, "phones_valid": 0,
                         "intent": [], "source_errors": {}, "web_searches": 0}
        # Free web search tolerates little volume, so each run gets a fixed number of queries.
        self.budget = max(10, min(60, int(params.get("limit") or 50) * 2))

    # ------------------------------------------------------------ plumbing
    def has(self, name: str) -> bool:
        return name in self.src

    def take_search(self, name: str) -> bool:
        """Reserve one web query for `name`; False once the run's budget is spent or the source is off."""
        if not self.has(name):
            return False
        with self.lock:
            if self.progress["web_searches"] >= self.budget:
                return False
            self.progress["web_searches"] += 1
            return True

    def emit(self, step=None, pct=None, msg=None, level="info", **inc):
        with self.lock:
            if step:
                self.progress["step"] = step
            if pct is not None:
                self.progress["pct"] = max(self.progress["pct"], pct)
            for k, v in inc.items():
                self.progress[k] = self.progress.get(k, 0) + v
            snapshot = dict(self.progress)
        db.update_search(self.sid, progress=snapshot)
        if msg:
            db.log(self.sid, level, msg)

    def fail(self, name: str, e: Exception):
        """Record a source failure once per search; it never stops the run."""
        kind = "needs a key" if isinstance(e, NeedsKey) else "blocked" if isinstance(e, Blocked) else "failed"
        with self.lock:
            first = name not in self.progress["source_errors"]
            self.progress["source_errors"][name] = f"{kind}: {str(e)[:140]}"
        if first:
            db.log(self.sid, "warn", f"{name} {kind}: {str(e)[:140]}")

    def safe(self, name: str, fn, *args):
        if not self.has(name):
            return None
        try:
            return fn(*args)
        except Exception as e:  # noqa: BLE001
            self.fail(name, e)
            return None

    # ------------------------------------------------------------ run
    def run(self):
        p = self.p
        limit = int(p.get("limit") or 50)
        db.update_search(self.sid, state="running", last_run=db.now(), last_error=None)
        self.emit("exclusion", 2, "Loading past campaigns as an exclusion list")
        arch = archive()
        known = arch["keys"]
        self.emit(msg=f"{arch['businesses']:,} businesses from past campaigns will be skipped")

        label, filters = niches.resolve(p["niche"])
        self.emit("locate", 4, f"Locating {p['location']} ({self.cc})")
        place = osm.geocode(p["location"], self.cc)
        if not place:
            raise RuntimeError(f"Couldn't find “{p['location']}” in {self.cc} on the map")
        self.emit(msg=f"Area: {place['display'][:110]}")

        self.emit("discover", 6)
        candidates: list[dict] = []
        if self.has("Google Maps"):
            self.emit(msg=f"Google Maps: searching “{p['niche']} {p['location']}”")
            urls = self.safe("Google Maps", gmaps.search, f"{p['niche']} {p['location']}", min(limit * 2, 80)) or []
            places: list[dict] = []
            for i in range(0, len(urls), 8):
                places += self.safe("Google Maps", gmaps.details, urls[i:i + 8]) or []
                self.emit(pct=9 + int(11 * min(1, (i + 8) / max(1, len(urls)))))
            for g in places:
                g["city"] = g["city"] or place["name"]
            candidates += places
            self.emit(msg=f"Google Maps: {len(places)} places read")
        if self.has("OpenStreetMap"):
            found = self.safe("OpenStreetMap", osm.find, filters, place, limit) or []
            candidates += found
            self.emit(pct=21, msg=f"OpenStreetMap: {len(found)} {label.lower()}")
        if self.has("Directories"):
            listed = self.safe("Directories", web.directory, p["niche"], p["location"], self.cc) or []
            for d in listed:
                d["city"] = d["city"] or place["name"]
            candidates += listed
            self.emit(msg=f"Directories: {len(listed)} listings")
        if self.take_search("Reddit"):
            intent = self.safe("Reddit", web.reddit_intent, p["niche"], p["location"], self.cc) or []
            with self.lock:
                self.progress["intent"] = intent
            self.emit(msg=f"Reddit: {len(intent)} posts from people asking about {p['niche']}")

        merged = merge_candidates(candidates)
        fresh = []
        for c in merged:
            keys = keys_for(c["emails"][0] if c["emails"] else "", c["website"], c["phones"], c["name"], c["city"], c["emails"][1:])
            if keys & known:
                self.emit(known=1)
            elif db.lead_for_keys(keys):
                self.emit(already=1)
            else:
                fresh.append(c)
        # businesses already rich in contacts first
        fresh.sort(key=lambda c: -(bool(c["website"]) * 2 + bool(c["phones"]) + bool(c["emails"]) * 3 + (c["maps"].get("reviews") or 0) / 100))
        with self.lock:
            skipped_known, skipped_already = self.progress["known"], self.progress["already"]
        self.emit("enrich", 22, f"{len(merged)} unique businesses · {skipped_known} skipped (past campaigns) · "
                                f"{skipped_already} already in Lead Radar · {len(fresh)} to check",
                  found=len(merged), total=len(fresh))

        stop = threading.Event()
        if fresh:
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = [pool.submit(self.process, c, place, label, known, stop, limit) for c in fresh]
                for i, f in enumerate(as_completed(futures), 1):
                    try:
                        f.result()
                    except Exception as e:  # noqa: BLE001
                        db.log(self.sid, "warn", f"A business check failed: {str(e)[:140]}")
                    self.emit(pct=22 + int(76 * i / len(futures)), checked=1)

        if self.has("AI agent") and llm.available():
            mine = sorted((l for l in db.all_leads() if l.get("search_id") == self.sid and "AI agent" not in l["sources"]),
                          key=lambda l: -l["score"])[:5]
            if mine:
                self.emit("agent", 98, f"AI agent: researching the top {len(mine)} leads")
            for l in mine:
                job = agent.research(l["id"], log=lambda t, n=l["name"]: db.log(self.sid, "agent", f"AI · {n}: {t}"))
                if job["state"] == "error":
                    self.fail("AI agent", RuntimeError(job["error"]))
                    break

        s = self.progress
        self.emit("done", 100, f"Done: {s['saved']} leads saved ({s['new']} new) · {s['emails_valid']} verified emails · "
                               f"{s['phones_valid']} valid phones · {s['no_contact']} dropped without a confirmed contact",
                  level="done")
        db.update_search(self.sid, state="done")

    # ------------------------------------------------------------ one business
    def process(self, c: dict, place: dict, label: str, known: set, stop: threading.Event, limit: int):
        if stop.is_set():
            return
        cc, name, city = self.cc, c["name"], c["city"] or place["name"]
        sources = list(c["sources"])
        socials = dict(c.get("socials") or {})
        website = c["website"] or ""
        profiles: dict[str, str] = {}
        if website and NOT_A_WEBSITE.search(host_of(website)):
            h = host_of(website)
            for k in ("facebook", "instagram", "linkedin", "tiktok"):
                if k in h:
                    socials.setdefault(k, website)
            if "doctolib" in h:
                profiles["doctolib"] = website
            website = ""

        site = None
        if website and (self.has("Website crawl") or self.has("Website audit")):
            site = crawl(website, cc)
        if not website and self.take_search("Web search"):
            try:
                tokens = [t for t in norm(name).split() if len(t) >= 4]
                tried = 0
                for res in websearch.search(f'"{name}" {city}', cc, 8):
                    h = host_of(res["url"])
                    blurb = norm(res["title"] + " " + res["snippet"] + " " + h.replace(".", " "))
                    if not h or NOT_A_WEBSITE.search(h) or not any(t in blurb for t in tokens):
                        continue
                    candidate = crawl(res["url"], cc, max_pages=3)
                    tried += 1
                    if site_matches(name, city, c["phones"], candidate):
                        website, site = candidate["final_url"], candidate
                        sources.append("Web search")
                        break
                    if tried >= 2:
                        break
            except Exception as e:  # noqa: BLE001
                self.fail("Web search", e)
        if stop.is_set():
            return
        if site and site["reachable"]:
            sources += ["Website crawl"]
            for k, v in site["socials"].items():
                socials.setdefault(k, v)

        site_emails = list(site["emails"]) if site else []
        site_phones = list(site["phones"]) if site else []
        if keys_for("", website, c["phones"] + site_phones, name, city, c["emails"] + site_emails) & known:
            self.emit(known=1, msg=f"– {name}: already in a past campaign", level="skip")
            return

        # ---- more email candidates: Hunter for the domain when the site itself shows none
        host = host_of(website)
        hunter_hits: list[dict] = []
        if host and not site_emails and not c["emails"] and self.has("Hunter"):
            found = self.safe("Hunter", hunter.domain_search, host) or {}
            hunter_hits = sorted(found.get("emails", []), key=lambda e: -(e.get("confidence") or 0))[:3]
            if hunter_hits:
                sources.append("Hunter")

        # ---- confirm emails (own-domain addresses first)
        emails = list(dict.fromkeys([e.lower() for e in c["emails"]] + site_emails + [h["address"] for h in hunter_hits]))
        emails.sort(key=lambda e: 0 if host and e.endswith("@" + host) else 1 if FREEMAIL.match(e.split("@")[-1]) else 2)
        if self.has("Email check"):
            checks = [verify_email(e) for e in emails[:3]]
            if checks:
                sources.append("Email check")
        else:
            checks = [{"address": e, "verdict": "unknown", "reason": "Email check turned off"} for e in emails[:3]]
        good = [x for x in checks if x["verdict"] == "valid"] + [x for x in checks if x["verdict"] in ("risky", "unknown")]

        # ---- confirm phones
        phones: dict[str, dict] = {}
        for raw in c["phones"] + site_phones:
            v = verify_phone(raw, cc)
            if v:
                phones.setdefault(v["e164"], {**v, "found_on": "their website" if raw in site_phones else c["sources"][0]})
        whatsapp = ""
        if site and site["whatsapp"]:
            v = verify_phone(site["whatsapp"], cc)
            whatsapp = v["e164"] if v else ""

        if not good and not phones:
            self.emit(no_contact=1, msg=f"– {name}: no contact could be confirmed, not saved", level="skip")
            return

        audit: dict = {"has_site": bool(website)}
        if website:
            audit["reachable"] = bool(site and site["reachable"])
            if site and site["reachable"] and self.has("Website audit"):
                audit.update(https=site["https"], mobile=site["mobile"], booking=site["booking"], form=site["form"],
                             chat=site["chat"], whatsapp=bool(site["whatsapp"]), load_ms=site["load_ms"])
                sources.append("Website audit")

        lead = {
            "name": name, "niche": label, "category": c.get("category") or "", "country": cc, "city": city, "region": "",
            "address": ", ".join(x for x in (c.get("address"), c.get("postcode")) if x),
            "lat": c.get("lat"), "lon": c.get("lon"),
            "phones": [x["display"] for x in phones.values()], "whatsapp": whatsapp,
            "email": good[0]["address"] if good else "", "other_emails": [x["address"] for x in good[1:]],
            "email_status": good[0]["verdict"] if good else ("invalid" if checks else "none"),
            "mx": good[0].get("mx", "") if good else "", "website": website, "audit": audit, "maps": c.get("maps") or {},
            "socials": socials, "ads": None, "size": "", "sources": sources,
            "datasets": [f"{label} · {self.p['location']}"],
            "outreach": {"status": "new", "sent": "", "channel": "", "campaign": "", "note": ""},
            "checks": {"emails": checks, "phones": list(phones.values())},
            "people": [], "registry": None, "domain": None, "trustpilot": None, "profiles": profiles, "search_id": self.sid,
        }
        if profiles.get("doctolib"):
            audit["booking_via"] = "Doctolib"
            sources.append("Doctolib")

        # ---- enrichment, only for leads we will keep
        reg = self.safe("Company registry", web.company_registry, name, cc, c.get("postcode") or "", city)
        if reg:
            lead["registry"] = reg
            lead["people"] += [{"name": d, "title": "Director (company registry)", "url": "", "via": "Company registry"} for d in reg["directors"]]
            sources.append("Company registry")
        if label in niches.MEDICAL and not audit.get("booking") and not profiles.get("doctolib") and self.take_search("Doctolib"):
            url = self.safe("Doctolib", web.doctolib, name, city, cc)
            if url:
                profiles["doctolib"] = url
                audit["booking_via"] = "Doctolib"
                sources.append("Doctolib")
        if website:
            dom = self.safe("Domain history", web.domain_history, website)
            if dom:
                lead["domain"] = dom
                sources.append("Domain history")
        wanted = [(n, k) for n, k in (("Facebook", "facebook"), ("Instagram", "instagram"), ("TikTok", "tiktok"), ("LinkedIn", "linkedin")) if self.has(n) and k not in socials]
        ig_snippet = ""
        if wanted and self.take_search(wanted[0][0]):
            found = self.safe(wanted[0][0], web.social_profiles, name, city, cc, [k for _, k in wanted]) or {}
            ig_snippet = found.pop("instagram_snippet", "")
            for k, v in found.items():
                socials.setdefault(k, v)
        for n, k in (("Facebook", "facebook"), ("Instagram", "instagram"), ("TikTok", "tiktok")):
            if k in socials:
                sources.append(n)
        if socials.get("instagram") and self.has("Instagram"):
            ig = self.safe("Instagram", instagram.profile, socials["instagram"])
            if ig is None and ig_snippet:
                ig = {"url": socials["instagram"], **instagram.stats_from_snippet(ig_snippet), "via": "search snippet"}
            if ig:
                lead["instagram"] = ig
                for e in ig.get("emails", []):
                    if e not in {x["address"] for x in checks} and self.has("Email check"):
                        v = verify_email(e)
                        checks.append(v)
                        if v["verdict"] == "valid" and lead["email_status"] != "valid":
                            lead["other_emails"] = [x for x in [lead["email"], *lead["other_emails"]] if x]
                            lead["email"], lead["email_status"], lead["mx"] = v["address"], "valid", v["mx"]
        people = self.safe("LinkedIn", web.linkedin_people, name, city, cc) if self.take_search("LinkedIn") else None
        if people or "linkedin" in socials:
            lead["people"] += people or []
            sources.append("LinkedIn")
        if host:
            team = self.safe("Apollo", web.apollo, host)
            if team:
                lead["people"] += team
                sources.append("Apollo")
            tp = self.safe("Trustpilot", web.trustpilot, website)
            if tp:
                lead["trustpilot"] = tp
                sources.append("Trustpilot")
        ads = self.safe("Meta Ad Library", web.meta_ads, name, cc)
        if ads is not None:
            lead["ads"] = ads["count"] > 0
            lead["ads_count"] = ads["count"]
            lead["profiles"]["ad_library"] = ads["url"]
            if ads["count"] > 0:
                sources.append("Meta Ad Library")

        lead["sources"] = list(dict.fromkeys(sources))
        lead["score"], lead["score_parts"], lead["reasons"] = score(lead)
        keys = keys_for(lead["email"], website, list(phones) + c["phones"], name, city, lead["other_emails"])

        with self.lock:
            if self.progress["saved"] >= limit:
                stop.set()
                return
            self.progress["saved"] += 1
        new = db.save_lead(lead, keys, self.sid)
        self.emit(msg=f"✓ {name}: {EMAIL_WORD[lead['email_status']]}, {len(phones)} valid phone{'' if len(phones) == 1 else 's'} · score {lead['score']}",
                  level="lead", new=int(new), emails_valid=int(lead["email_status"] == "valid"),
                  emails_risky=int(lead["email_status"] == "risky"), phones_valid=len(phones))
        with self.lock:
            if self.progress["saved"] >= limit:
                stop.set()
