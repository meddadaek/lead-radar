"""AI agent (Groq): plans searches from a plain request, and researches one lead with web tools.

Grounding rule: a person, email or profile from the model is kept only if it
appears in a page or search result the agent actually saw, and every email is
then confirmed with its mail server like any other.
"""
import json
import re
import threading

from . import db, llm
from .enrich import fetch, visible_text
from .known import norm
from .score import score
from .sources import tavily, websearch
from .verify import EMAIL_RE, verify_email

# ---------------------------------------------------------------- planning

PLAN_SYSTEM = """You plan lead-generation searches for a small web and AI agency.
Turn the user's request into concrete searches the engine can run.
Return JSON only:
{"searches":[{"niche":"","location":"","country":"","limit":20,"why":""}],"notes":""}
Rules:
- niche: the short business type in the local language Google Maps uses there (e.g. "dentiste" in France, "dentist" in the US).
- location: one city or region per search. Split a whole country into its biggest relevant cities.
- country: ISO 3166-1 alpha-2 code.
- limit: leads to save per search, 5 to 100.
- At most 6 searches. Never invent business names."""


def plan(request: str) -> dict:
    msg = llm.chat([{"role": "system", "content": PLAN_SYSTEM}, {"role": "user", "content": request}], json_mode=True, temperature=0.3)
    data = llm.parse_json(msg.get("content") or "")
    searches = []
    for s in (data.get("searches") or [])[:6]:
        niche, loc, cc = str(s.get("niche", "")).strip(), str(s.get("location", "")).strip(), str(s.get("country", "")).strip().upper()
        if len(niche) < 2 or len(loc) < 2 or not re.fullmatch(r"[A-Z]{2}", cc):
            continue
        try:
            limit = int(s.get("limit") or 20)
        except (TypeError, ValueError):
            limit = 20
        searches.append({"niche": niche[:80], "location": loc[:120], "country": cc, "limit": max(5, min(100, limit)),
                         "why": str(s.get("why", ""))[:200]})
    return {"searches": searches, "notes": str(data.get("notes", ""))[:400], "model": llm.model()}


# ---------------------------------------------------------------- lead research

# Actions are plain JSON replies rather than native tool calls: Groq's tool-call parser rejects
# gpt-oss output often enough to break runs, while JSON mode is reliable on every model it serves.
RESEARCH_SYSTEM = """You research ONE business for a web and AI agency's outreach.
Never guess. Every person, email and profile you report must appear in a search result or page you saw, with its URL.
Find: (1) the owner or decision maker (name and role), (2) direct email addresses, (3) official social profiles,
(4) one short outreach angle based ONLY on the audit facts provided (no invented problems).

Each reply is ONE JSON object choosing one action:
{"action":"web_search","query":"...","domains":["linkedin.com"]}   (domains optional)
{"action":"read_page","url":"https://..."}
{"action":"final","people":[{"name":"","title":"","source_url":""}],"emails":[{"address":"","source_url":""}],
 "socials":{"linkedin":"","instagram":"","facebook":"","tiktok":""},"angle":""}
Use at most 6 searches or page reads, then reply with the final action."""

_jobs: dict[str, dict] = {}


def status(lead_id: str) -> dict | None:
    return _jobs.get(lead_id)


def start(lead_id: str) -> bool:
    job = _jobs.get(lead_id)
    if job and job["state"] == "running":
        return False
    lead = db.get_lead(lead_id)
    if not lead:
        raise KeyError(lead_id)
    llm.model()  # fail fast (NeedsKey / Blocked) before starting a thread
    job = {"state": "running", "steps": [], "result": None, "error": None, "started": db.now()}
    _jobs[lead_id] = job
    threading.Thread(target=research, args=(lead_id, job), daemon=True, name=f"agent-{lead_id}").start()
    return True


def research(lead_id: str, job: dict | None = None, log=None) -> dict:
    job = job if job is not None else {"state": "running", "steps": [], "result": None, "error": None, "started": db.now()}

    def step(kind: str, text: str):
        job["steps"].append({"ts": db.now(), "kind": kind, "text": text[:300]})
        if log:
            log(text)

    lead = db.get_lead(lead_id)
    try:
        facts = {
            "name": lead["name"], "category": lead["category"], "city": lead["city"], "country": lead["country"],
            "website": lead["website"], "phones": lead["phones"], "known_email": lead["email"],
            "known_socials": lead["socials"], "google_rating": lead["maps"].get("rating"),
            "google_reviews": lead["maps"].get("reviews"),
            "audit_findings": [r[1] for r in lead.get("reasons", []) if r[0].startswith("+") and any(
                w in r[1].lower() for w in ("website", "booking", "mobile", "https", "form", "chat", "slow", "down", "review"))],
        }
        messages: list[dict] = [{"role": "system", "content": RESEARCH_SYSTEM},
                                {"role": "user", "content": "Business facts:\n" + json.dumps(facts, ensure_ascii=False)}]
        seen_urls: set[str] = set()
        seen_text: list[str] = []
        data: dict = {}
        step("think", f"Researching {lead['name']} with {llm.model()} · search via {websearch.engine_name()}")
        for turn in range(8):
            msg = llm.chat(messages, json_mode=True, temperature=0.1, max_tokens=1500)
            reply = msg.get("content") or ""
            args = llm.parse_json(reply)
            messages.append({"role": "assistant", "content": reply})
            action = args.get("action")
            if action == "final" or turn == 7:
                data = args if action == "final" else {}
                break
            if action == "web_search":
                domains = [d for d in (args.get("domains") or []) if isinstance(d, str)][:4]
                step("search", f"Searching “{args.get('query', '')}”" + (f" on {', '.join(domains)}" if domains else ""))
                try:
                    res = websearch.search(str(args.get("query", "")), lead["country"], 6, domains=domains or None)
                except Exception as e:  # noqa: BLE001
                    res = []
                    step("warn", f"Search failed: {e}")
                for r in res:
                    seen_urls.add(r["url"])
                    seen_text.append(f"{r['url']} {r['title']} {r['snippet']}")
                # keep what is resent small: Groq's free tier caps tokens per minute
                brief = [{"url": r["url"], "title": r["title"][:100], "snippet": r["snippet"][:260]} for r in res]
                content = "Search results: " + json.dumps(brief, ensure_ascii=False)
            elif action == "read_page":
                url = str(args.get("url", ""))
                step("read", f"Reading {url}")
                final, _, html, _ = fetch(url)
                text = visible_text(html)[:6000] if html else ""
                if not text and tavily.available():
                    try:
                        text = tavily.extract(url)[:6000]
                    except Exception:  # noqa: BLE001
                        text = ""
                if text:
                    seen_urls.update({url, final})
                    seen_text.append(f"{url} {text}")
                content = f"Page {url}: " + (text[:2500] if text else "could not be read.")
            else:
                content = 'Reply with one JSON object whose "action" is web_search, read_page or final.'
            messages.append({"role": "user", "content": content})
        if not data:
            msg = llm.chat(messages + [{"role": "user", "content": 'Stop searching. Reply now with the {"action":"final",...} JSON.'}], json_mode=True)
            data = llm.parse_json(msg.get("content") or "")

        # ---- keep only what the agent actually saw
        corpus = " ".join(seen_text).lower()
        corpus_norm = norm(corpus)
        people = []
        for p in data.get("people") or []:
            nm = str(p.get("name", "")).strip()
            if nm and all(part in corpus_norm for part in norm(nm).split()[-2:]):
                people.append({"name": nm, "title": str(p.get("title", ""))[:80], "url": str(p.get("source_url", "")), "via": "AI agent"})
        emails = sorted({str(e.get("address", "")).strip().lower() for e in data.get("emails") or []
                         if EMAIL_RE.match(str(e.get("address", "")).strip()) and str(e.get("address", "")).strip().lower() in corpus})
        socials = {k: v for k, v in (data.get("socials") or {}).items()
                   if isinstance(v, str) and v and any(v.rstrip("/") in u for u in seen_urls)}
        dropped = len(data.get("people") or []) - len(people)
        if dropped > 0:
            step("warn", f"Discarded {dropped} person(s) the sources did not show")

        checks = []
        if emails:
            step("verify", f"Confirming {len(emails)} email(s) with their mail servers")
            checks = [verify_email(e) for e in emails[:4]]

        fresh = db.get_lead(lead_id)
        known_checks = fresh.setdefault("checks", {"emails": [], "phones": []}).setdefault("emails", [])
        have = {c["address"] for c in known_checks}
        known_checks += [c for c in checks if c["address"] not in have]
        good = sorted([c for c in known_checks if c["verdict"] in ("valid", "risky")], key=lambda c: c["verdict"] != "valid")
        if good:
            fresh["email"], fresh["email_status"] = good[0]["address"], good[0]["verdict"]
            fresh["other_emails"] = [c["address"] for c in good[1:]]
        names = {norm(p["name"]) for p in fresh.get("people") or []}
        fresh["people"] = (fresh.get("people") or []) + [p for p in people if norm(p["name"]) not in names]
        for k, v in socials.items():
            fresh.setdefault("socials", {}).setdefault(k, v)
        if data.get("angle"):
            fresh["angle"] = str(data["angle"])[:320]
        fresh["agent"] = {"researched_at": db.now(), "model": llm.model(), "evidence": sorted(seen_urls)[:15]}
        if "AI agent" not in fresh["sources"]:
            fresh["sources"].append("AI agent")
        fresh["score"], fresh["score_parts"], fresh["reasons"] = score(fresh)
        db.update_lead(fresh)

        valid = sum(c["verdict"] == "valid" for c in checks)
        job["result"] = {"people": people, "emails": checks, "socials": socials, "angle": fresh.get("angle", "")}
        step("done", f"Done: {len(people)} people · {valid} verified email(s) · {len(socials)} profile(s)")
        job["state"] = "done"
    except Exception as e:  # noqa: BLE001
        job["state"], job["error"] = "error", str(e)[:300]
        step("error", str(e))
    return job
