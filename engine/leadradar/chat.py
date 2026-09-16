"""Radar, the chat agent: talk to it and it operates Lead Radar through the same functions the UI uses.

Each model turn is one JSON object: either a tool call the engine runs, or the answer plus
UI actions the web app performs (open a lead, filter the list, change a status, switch page).
The agent may only report what its tools returned; lead ids in its answer are checked against the database.
"""
import json
import threading
import uuid

from . import agent, db, health, llm, pipeline
from .known import norm
from .sources import websearch
from .verify import verify_email

ALL_SOURCES = ["Google Maps", "OpenStreetMap", "Directories", "Company registry", "Doctolib", "Web search",
               "Website crawl", "Website audit", "Domain history", "LinkedIn", "Apollo", "Facebook", "Instagram",
               "TikTok", "Reddit", "Meta Ad Library", "Trustpilot", "Hunter", "Email check", "AI agent"]
STATUSES = {"new", "contacted", "replied", "won", "not_interested"}
PAGES = {"overview", "leads", "searches", "settings"}
BRIEF_KEYS = ("id", "name", "niche", "city", "country", "score", "email", "email_status", "phone", "website", "status",
              "rating", "reviews", "decision_maker", "why", "found")

SYSTEM = """You are Radar, the AI operator inside Lead Radar, the lead-generation app of a small web and AI agency.
You talk with the owner and DO the work in the app with tools. Answer in the user's language (English, French or
Algerian darija; they often make typos). Be short and concrete.

Each reply is ONE JSON object, nothing else:
- run a tool:  {"tool":"<name>","args":{...}}
- answer:      {"reply":"<short answer>","lead_ids":["<ids of leads you mention>"],"ui":[<ui actions>]}

Tools:
- find_leads {text?, niche?, country?, city?, min_score?, email_status? ("valid"|"risky"|"invalid"|"none"), has_phone?, no_website?, status?, search_id?, sort? ("score"|"newest"), limit? (max 15)}: search saved leads. Returns total and the best matches.
- lead_details {lead_id}: everything known about one lead.
- start_search {niche, location, country, limit}: find NEW businesses (runs in the background for several minutes, skips past campaigns). niche = the local-language word Google Maps uses ("dentiste" in France, "dentist" in the US). country = ISO code. limit 5-100.
- searches {}: recent searches with progress and results.
- research_lead {lead_id}: start AI research on one lead (owner, direct emails, profiles, outreach angle) in the background.
- verify_email {address}: confirm a mailbox exists (nothing is sent).
- web_search {query, domains?}: search the web.
- test_sources {}: start a live test of every data source.

UI actions (the app performs them when you answer):
- {"type":"navigate","page":"overview"|"leads"|"searches"|"settings"}
- {"type":"open_lead","lead_id":"..."}
- {"type":"filter_leads","filters":{"country":"FR","niche":"Dental","email":"valid"|"risky"|"invalid"|"none","site":"none"|"gaps"|"has","status":"new"|"contacted"|"replied"|"won"|"not_interested","minScore":60,"q":"text"}}
- {"type":"set_status","lead_ids":["..."],"status":"new"|"contacted"|"replied"|"won"|"not_interested"}

Rules:
- Never invent leads, emails, phone numbers, people or counts. Only state what a tool returned in this conversation.
- When the user asks for something the tools can do, do it instead of explaining how.
- Starting more than 3 searches at once needs the user's confirmation first.
- After starting a search or research, say it runs in the background and where to watch it."""

_jobs: dict[str, dict] = {}


# ---------------------------------------------------------------- lead views

def _brief(l: dict) -> dict:
    person = (l.get("people") or [{}])[0]
    return {
        "id": l["id"], "name": l["name"], "niche": l["niche"], "city": l["city"], "country": l["country"],
        "score": l["score"], "email": l["email"], "email_status": l["email_status"],
        "phone": (l.get("phones") or [""])[0], "website": l["website"], "status": l["outreach"]["status"],
        "rating": l["maps"].get("rating"), "reviews": l["maps"].get("reviews"),
        "decision_maker": f"{person.get('name')} ({person.get('title')})" if person.get("name") else "",
        "why": [r[1] for r in l.get("reasons", [])[:4]], "found": (l.get("found_at") or "")[:10],
    }


def _leads(statuses: dict) -> list[dict]:
    out = []
    for l in db.all_leads():
        if statuses.get(l["id"]) in STATUSES:
            l["outreach"]["status"] = statuses[l["id"]]
        out.append(l)
    return out


def find_leads(args: dict, statuses: dict) -> dict:
    rows = _leads(statuses)
    text = norm(str(args.get("text") or ""))
    niche = norm(str(args.get("niche") or ""))
    city = norm(str(args.get("city") or ""))
    country = str(args.get("country") or "").upper()
    es = str(args.get("email_status") or "").lower()
    try:
        min_score = int(args.get("min_score") or 0)
    except (TypeError, ValueError):
        min_score = 0

    def keep(l):
        if text and text not in norm(" ".join([l["name"], l["email"], l["city"], l["website"], l["category"], l["niche"]])):
            return False
        if niche and niche not in norm(l["niche"] + " " + l["category"]):
            return False
        if city and city not in norm(l["city"] + " " + l["address"]):
            return False
        if country and l["country"] != country:
            return False
        if es == "none" and l["email"]:
            return False
        if es and es != "none" and l["email_status"] != es:
            return False
        if args.get("has_phone") and not l["phones"]:
            return False
        if args.get("no_website") and l["website"]:
            return False
        if args.get("status") and l["outreach"]["status"] != args["status"]:
            return False
        if args.get("search_id") and l.get("search_id") != args["search_id"]:
            return False
        return l["score"] >= min_score

    hits = [l for l in rows if keep(l)]
    if args.get("sort") == "newest":
        hits.sort(key=lambda l: l.get("found_at") or "", reverse=True)
    else:
        hits.sort(key=lambda l: l["score"], reverse=True)
    try:
        limit = max(1, min(15, int(args.get("limit") or 8)))
    except (TypeError, ValueError):
        limit = 8
    return {"total": len(hits), "of_all": len(rows), "leads": [_brief(l) for l in hits[:limit]]}


def lead_details(args: dict, statuses: dict) -> dict:
    l = db.get_lead(str(args.get("lead_id") or ""))
    if not l:
        return {"error": "No lead with that id"}
    if statuses.get(l["id"]) in STATUSES:
        l["outreach"]["status"] = statuses[l["id"]]
    return {
        **_brief(l), "address": l["address"], "all_phones": l["phones"], "whatsapp": l["whatsapp"],
        "emails_checked": [{"address": c["address"], "verdict": c["verdict"], "reason": c["reason"]}
                           for c in (l.get("checks") or {}).get("emails", [])],
        "people": [{"name": p["name"], "title": p["title"], "via": p["via"]} for p in (l.get("people") or [])[:6]],
        "socials": l["socials"], "audit": l["audit"], "all_reasons": l["reasons"], "angle": l.get("angle", ""),
        "running_ads": l.get("ads"), "registry": (l.get("registry") or {}).get("legal_name"),
        "researched_by_ai": bool(l.get("agent")), "sources": l["sources"],
    }


def start_search(args: dict) -> dict:
    niche, location = str(args.get("niche") or "").strip(), str(args.get("location") or "").strip()
    country = str(args.get("country") or "").strip().upper()
    if len(niche) < 2 or len(location) < 2 or len(country) != 2:
        return {"error": "Need niche, location and a 2-letter country code"}
    try:
        limit = max(5, min(100, int(args.get("limit") or 20)))
    except (TypeError, ValueError):
        limit = 20
    s = db.add_search({"niche": niche, "location": location, "country": country, "limit": limit, "sources": ALL_SOURCES})
    pipeline.start(s["id"])
    return {"started": True, "search_id": s["id"], "niche": niche, "location": location, "country": country,
            "limit": limit, "note": "Runs in the background; progress is on the Searches page."}


def searches(_args: dict) -> dict:
    live = set(pipeline.running())
    out = []
    for s in db.list_searches()[:8]:
        p = s["progress"] or {}
        out.append({"id": s["id"], **{k: s["params"][k] for k in ("niche", "location", "country", "limit")},
                    "state": "running" if s["id"] in live else s["state"], "pct": p.get("pct", 0),
                    "saved": p.get("saved", 0), "new": p.get("new", 0), "verified_emails": p.get("emails_valid", 0),
                    "skipped_past_campaigns": p.get("known", 0), "error": s["last_error"], "last_run": s["last_run"]})
    return {"searches": out}


def research_lead(args: dict) -> dict:
    lead_id = str(args.get("lead_id") or "")
    if not db.get_lead(lead_id):
        return {"error": "No lead with that id"}
    started = agent.start(lead_id)
    return {"started": started, "lead_id": lead_id,
            "note": "Runs in the background (about a minute); results appear in the lead's panel."
            if started else "Already running for this lead."}


def web_search_tool(args: dict) -> dict:
    domains = [d for d in (args.get("domains") or []) if isinstance(d, str)][:4] or None
    res = websearch.search(str(args.get("query") or ""), "", 6, domains=domains)
    return {"results": [{"url": r["url"], "title": r["title"][:100], "snippet": r["snippet"][:240]} for r in res]}


def run_tool(name: str, args: dict, statuses: dict) -> tuple[dict, str]:
    """Returns (result for the model, one-line description for the UI)."""
    if name == "find_leads":
        r = find_leads(args, statuses)
        return r, f"Found {r['total']} matching leads"
    if name == "lead_details":
        r = lead_details(args, statuses)
        return r, r.get("error") or f"Read {r['name']}"
    if name == "start_search":
        r = start_search(args)
        return r, r.get("error") or f"Started search: {r['niche']} in {r['location']}, {r['country']} ({r['limit']} leads)"
    if name == "searches":
        r = searches(args)
        return r, f"Checked {len(r['searches'])} searches"
    if name == "research_lead":
        r = research_lead(args)
        return r, r.get("error") or ("Started AI research on the lead" if r["started"] else "Research already running")
    if name == "verify_email":
        v = verify_email(str(args.get("address") or ""))
        return {k: v.get(k) for k in ("address", "verdict", "reason", "catch_all")}, f"Verified {v['address']}: {v['verdict']}"
    if name == "web_search":
        r = web_search_tool(args)
        return r, f"Searched the web: {len(r['results'])} results"
    if name == "test_sources":
        started = health.start()
        return {"started": started, "note": "Results appear on the Searches and API keys pages."}, "Started the live source test"
    return {"error": f"Unknown tool {name}"}, f"Unknown tool {name}"


# ---------------------------------------------------------------- conversation loop

TOOL_LABEL = {"find_leads": "Searching your leads", "lead_details": "Reading the lead", "start_search": "Starting a search",
              "searches": "Checking searches", "research_lead": "Starting AI research", "verify_email": "Verifying email",
              "web_search": "Searching the web", "test_sources": "Testing sources"}


def _clean_ui(actions, valid_ids: set) -> list[dict]:
    out = []
    for a in actions if isinstance(actions, list) else []:
        if not isinstance(a, dict):
            continue
        t = a.get("type")
        if t == "navigate" and a.get("page") in PAGES:
            out.append({"type": t, "page": a["page"]})
        elif t == "open_lead" and a.get("lead_id") in valid_ids:
            out.append({"type": t, "lead_id": a["lead_id"]})
        elif t == "filter_leads" and isinstance(a.get("filters"), dict):
            f = a["filters"]
            out.append({"type": t, "filters": {k: f[k] for k in ("country", "niche", "email", "site", "status", "minScore", "q")
                                               if f.get(k) not in (None, "")}})
        elif t == "set_status" and a.get("status") in STATUSES:
            ids = [i for i in (a.get("lead_ids") or []) if i in valid_ids]
            if ids:
                out.append({"type": t, "lead_ids": ids, "status": a["status"]})
    return out[:5]


def run(job: dict, history: list[dict], statuses: dict):
    def step(kind: str, text: str):
        job["steps"].append({"ts": db.now(), "kind": kind, "text": text[:220]})

    try:
        messages = [{"role": "system", "content": SYSTEM}]
        for m in history[-12:]:
            if m.get("role") in ("user", "assistant") and m.get("content"):
                messages.append({"role": m["role"], "content": str(m["content"])[:1500]})
        seen_ids: set[str] = set()
        answer: dict = {}
        for turn in range(7):
            msg = llm.chat(messages, json_mode=True, temperature=0.2, max_tokens=1200)
            raw = msg.get("content") or ""
            data = llm.parse_json(raw)
            messages.append({"role": "assistant", "content": raw})
            if "reply" in data:
                answer = data
                break
            name = data.get("tool")
            if not name:
                messages.append({"role": "user", "content": 'Reply with ONE JSON object: {"tool":...} or {"reply":...}.'})
                continue
            args = data.get("args") if isinstance(data.get("args"), dict) else {}
            step("tool", TOOL_LABEL.get(name, name) + "…")
            try:
                result, summary = run_tool(name, args, statuses)
            except Exception as e:  # noqa: BLE001 - tell the model and keep the conversation going
                result, summary = {"error": str(e)[:200]}, f"{name} failed: {str(e)[:120]}"
            job["tools"].append(name)
            step("result", summary)
            for l in result.get("leads", []):
                seen_ids.add(l["id"])
                job["cards"][l["id"]] = l
            if name == "lead_details" and result.get("id"):
                seen_ids.add(result["id"])
                job["cards"][result["id"]] = {k: result[k] for k in BRIEF_KEYS if k in result}
            if result.get("lead_id"):
                seen_ids.add(result["lead_id"])
            messages.append({"role": "user", "content": f"Tool {name} result: " + json.dumps(result, ensure_ascii=False)[:3000]})
        if "reply" not in answer:
            msg = llm.chat(messages + [{"role": "user", "content": 'Stop using tools and answer now: {"reply":...}'}],
                           json_mode=True, max_tokens=900)
            answer = llm.parse_json(msg.get("content") or "")

        existing = {l["id"] for l in db.all_leads()}
        valid = (seen_ids | set(answer.get("lead_ids") or [])) & existing
        job["reply"] = str(answer.get("reply") or "I couldn't finish that. Try asking again in other words.")[:2500]
        job["ui"] = _clean_ui(answer.get("ui"), valid)
        for i in [i for i in (answer.get("lead_ids") or []) if i in valid][:8]:
            card = job["cards"].get(i) or (_brief(l) if (l := db.get_lead(i)) else None)
            if card:
                job["leads"].append(card)
        job["model"] = llm.model()
        job["state"] = "done"
    except Exception as e:  # noqa: BLE001
        job["state"], job["error"] = "error", str(e)[:300]


def start(history: list[dict], statuses: dict) -> str:
    llm.model()  # fail fast if the Groq key is missing or rejected
    job_id = uuid.uuid4().hex[:12]
    job = {"id": job_id, "state": "running", "steps": [], "tools": [], "cards": {}, "reply": "", "ui": [], "leads": [],
           "error": None, "started": db.now()}
    _jobs[job_id] = job
    for old in list(_jobs)[:-50]:
        _jobs.pop(old, None)
    threading.Thread(target=run, args=(job, history, statuses), daemon=True, name=f"chat-{job_id}").start()
    return job_id


def status(job_id: str) -> dict | None:
    job = _jobs.get(job_id)
    return {k: v for k, v in job.items() if k != "cards"} if job else None
