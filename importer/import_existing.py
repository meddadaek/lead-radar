# -*- coding: utf-8 -*-
"""Import every lead we already collected into one normalized file for the dashboard.

The old campaigns each wrote their own CSV with their own column names
(hotel-prospector/*.csv). This reads all of them, maps them onto one schema,
merges duplicates (same email, or same name + city), attaches the outreach
history from the sent logs, and scores each lead with transparent rules.

Output: web/public/data/leads.json. Reads only; changes nothing in the old folder.
"""
import csv
import json
import re
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SRC = Path(r"D:\claudexx\hotel-prospector")
OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "data" / "leads.json"


def rows(name):
    path = SRC / name
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="replace")
    return list(csv.DictReader(text.splitlines(keepends=True)))


def g(r, *keys):
    for k in keys:
        v = (r.get(k) or "").strip()
        if v and v.lower() not in ("n/a", "none", "nan"):
            return v
    return ""


def norm(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower().strip()


def truthy(v):
    v = (v or "").strip().lower()
    return True if v == "true" else False if v == "false" else None


# ---------------------------------------------------------------- normalizers

RISKY = {"UNVERIFIED", "UNVERIFIABLE", "ACCEPT-ALL", "RISK", "RISK_UNVERIFIED"}
INVALID = {"BAD", "NOMX", "DEAD", "DEAD-DOMAIN", "DROP_BAD_EMAIL"}


def email_status(email, *signals):
    if not email:
        return "none"
    s = {x.strip().upper() for x in signals if x}
    if s & INVALID:
        return "invalid"
    if s & {"OK", "VERIFIED"}:
        return "valid"
    if s & RISKY:
        return "risky"
    if "SEND" in s:
        return "valid"
    return "unknown"


NICHES = [
    ("Dental", r"dent"),
    ("Medical", r"clinic|doctor|hospital|medic|surgic|laborator|pharmac|psycho|physio|kine|gyn|paediat|general|caarud|addict|sante"),
    ("Hospitality", r"hotel|guest_house|chalet|apartment|hostel|motel"),
    ("Real estate", r"immobil|real estate|estate_agent"),
    ("Car rental", r"location|rent"),
    ("Auto repair", r"car_repair"),
    ("Home services", r"hvac|plumb|electric|carpent|builder|roof|hardware|doityourself|climatisation|chauffage"),
    ("Beauty", r"hair|beauty"),
    ("Veterinary", r"veterin"),
    ("Travel agencies", r"voyage|travel"),
    ("Training centers", r"formation|school|training"),
]


def niche_of(*raw):
    text = " ".join(norm(x) for x in raw if x)
    for label, rx in NICHES:
        if re.search(rx, text):
            return label
    return "Other"


def country_from_phone(p):
    d = re.sub(r"[^\d+]", "", p or "")
    for pre, cc in (("+352", "LU"), ("+213", "DZ"), ("+33", "FR"), ("+32", "BE"), ("+41", "CH"), ("+1", "US")):
        if d.startswith(pre):
            return cc
    return ""


def clean_site(u):
    u = (u or "").strip()
    if not u or u.lower() in ("n/a", "none"):
        return ""
    if not u.startswith("http"):
        u = "https://" + u
    return u


FR_FLAGS = {
    "AUCUN-SITE": ("has_site", False), "SANS-FORMULAIRE": ("form", False), "SANS-RDV": ("booking", False),
    "PAS-HTTPS": ("https", False), "PAS-MOBILE": ("mobile", False), "HTTP-404": ("reachable", False),
    "INJOIGNABLE-2x": ("reachable", False), "INSTABLE": ("stable", False), "CERTIFICAT-INVALIDE": ("ssl_valid", False),
}


def audit_from_fr_flags(flags, ms, site):
    a = {"has_site": bool(site)}
    for f in (flags or "").split():
        if f in FR_FLAGS:
            k, v = FR_FLAGS[f]
            a[k] = v
    if a.get("has_site") and "reachable" not in a and flags:
        a["reachable"] = True
    m = re.match(r"(\d+)", ms or "")
    if m:
        a["load_ms"] = int(m.group(1))
    return a


def audit_from_bools(r, site):
    a = {"has_site": bool(site)}
    text = norm(r.get("audit", ""))
    if "pas de site" in text:
        a["has_site"] = False
    elif "injoignable" in text:
        a["reachable"] = False
    elif site:
        a["reachable"] = True
    for col, key in (("wa", "whatsapp"), ("chat", "chat"), ("booking", "booking"), ("form", "form"),
                     ("mobile", "mobile"), ("https", "https")):
        v = truthy(r.get(col))
        if v is not None and a.get("reachable"):
            a[key] = v
    slow = truthy(r.get("slow"))
    if slow is not None and a.get("reachable"):
        a["slow"] = slow
    return a


def audit_from_adlib(flags, site):
    a = {"has_site": bool(site), "reachable": True}
    m = re.search(r"([\d.]+)s", flags or "")
    if m:
        a["load_ms"] = int(float(m.group(1)) * 1000)
    if "NO-FORM" in (flags or ""):
        a["form"] = False
    if "NO-BOOKING" in (flags or ""):
        a["booking"] = False
    return a


# ---------------------------------------------------------------- per-file mappers

def base(**kw):
    lead = {
        "name": "", "niche": "Other", "category": "", "country": "", "city": "", "region": "", "address": "",
        "lat": None, "lon": None, "phones": [], "whatsapp": "", "email": "", "other_emails": [],
        "email_status": "none", "mx": "", "website": "", "audit": {}, "maps": {}, "socials": {},
        "ads": None, "size": "", "sources": [], "datasets": [],
        "outreach": {"status": "new", "sent": "", "channel": "", "campaign": "", "note": ""},
    }
    lead.update({k: v for k, v in kw.items() if v not in (None, "", [], {})})
    return lead


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def sent_outreach(r, channel="email"):
    sent = g(r, "sent")
    if not sent:
        return None
    return {"status": "contacted", "sent": sent[:10], "channel": channel, "campaign": g(r, "arm", "angle_used"), "note": ""}


OSM_CHECK = ["OpenStreetMap", "Website crawl", "Email check"]
addr_country = json.loads((SRC / "addr_country.json").read_text(encoding="utf-8"))


def load_all():
    out = []

    def add(dataset, lead, sources):
        lead["datasets"] = [dataset]
        lead["sources"] = list(sources)
        out.append(lead)

    for r in rows("dz_leads_today.csv"):
        src = g(r, "source")
        sources = [s for s, key in (("Google Maps", "Google Maps"), ("Meta Ad Library", "Ad Library"), ("OpenStreetMap", "OSM")) if key in src]
        email = g(r, "email")
        site = clean_site(g(r, "website"))
        add("dz_leads_today", base(
            name=g(r, "name"), niche=niche_of(g(r, "segment"), g(r, "category")), category=g(r, "category"),
            country="DZ", city=g(r, "area"), address=g(r, "address"),
            phones=[p.strip() for p in g(r, "phones").split(";") if p.strip()], whatsapp=g(r, "whatsapp"),
            email=email, email_status=email_status(email, g(r, "email_verdict")), website=site,
            audit={"has_site": bool(site)},
            maps={k: v for k, v in (("rating", num(g(r, "rating"))), ("reviews", int(num(g(r, "reviews")) or 0) or None),
                                    ("hours", g(r, "hours")), ("url", g(r, "maps"))) if v},
            ads=True if "Ad Library" in src else None,
        ), sources + (["Website crawl", "Email check"] if email else []))

    for name, cc_default in (("fr_med.csv", "FR"), ("dz_clinics.csv", "DZ"), ("dz2.csv", "DZ")):
        for r in rows(name):
            email = g(r, "email")
            cc = {"FRANCE": "FR", "ALGERIE": "DZ"}.get(addr_country.get(email, ""), cc_default)
            site = clean_site(g(r, "website"))
            lead = base(
                name=g(r, "name"), niche=niche_of(g(r, "kind"), g(r, "speciality")),
                category=", ".join(x for x in (g(r, "kind"), g(r, "speciality").replace(";", ", ")) if x),
                country=cc, city=g(r, "city"), region=g(r, "wilaya"), address=g(r, "postcode"),
                lat=num(g(r, "lat")), lon=num(g(r, "lon")), phones=[g(r, "phone")] if g(r, "phone") else [],
                email=email, email_status=email_status(email, g(r, "smtp")), mx=g(r, "mx"), website=site,
                audit={"has_site": bool(site)},
            )
            if o := sent_outreach(r):
                lead["outreach"] = o
            add(name[:-4], lead, OSM_CHECK)

    for name in ("fr2.csv", "fr_spec.csv"):
        for r in rows(name):
            email = g(r, "email")
            site = clean_site(g(r, "website"))
            lead = base(
                name=g(r, "name"), niche=niche_of(g(r, "speciality"), "medical"), category=g(r, "speciality").replace(";", ", "),
                country="FR", city=g(r, "city"), phones=[g(r, "phone")] if g(r, "phone") else [],
                email=email, email_status=email_status(email, g(r, "smtp")), mx=g(r, "mx"), website=site,
                audit=audit_from_fr_flags(g(r, "stable"), g(r, "ms"), site),
            )
            if o := sent_outreach(r):
                lead["outreach"] = o
            add(name[:-4], lead, OSM_CHECK + ["Website audit"])

    for r in rows("fr_eu_prospects.csv"):
        email = g(r, "email")
        region = g(r, "region")
        cc = country_from_phone(g(r, "phone")) or ("BE" if "Wallon" in region else "CH")
        site = clean_site(g(r, "website"))
        lead = base(
            name=g(r, "name"), niche=niche_of(g(r, "kind")), category=g(r, "kind").replace("_", " "),
            country=cc, city=g(r, "city"), region=region, lat=num(g(r, "lat")), lon=num(g(r, "lon")),
            phones=[g(r, "phone")] if g(r, "phone") else [], email=email,
            email_status=email_status(email, g(r, "smtp")), mx=g(r, "mx"), website=site,
            audit={"has_site": bool(site)}, size={"SMALL": "Small", "MID": "Mid-size"}.get(g(r, "segment"), ""),
        )
        if o := sent_outreach(r):
            lead["outreach"] = o
        add("fr_eu_prospects", lead, OSM_CHECK)

    for name, cc in (("us_prospects.csv", "US"), ("qc_prospects.csv", "CA")):
        for r in rows(name):
            email = g(r, "email")
            site = clean_site(g(r, "website"))
            socials = {"facebook": site} if "facebook.com" in site else {}
            if socials:
                site = ""
            lead = base(
                name=g(r, "name"), niche=niche_of(g(r, "craft")), category=g(r, "craft").replace("_", " "),
                country=cc, city=g(r, "city"), region=g(r, "state") or ("Québec" if cc == "CA" else ""),
                address=g(r, "street"), lat=num(g(r, "lat")), lon=num(g(r, "lon")),
                phones=[g(r, "phone")] if g(r, "phone") else [], email=email,
                email_status=email_status(email, g(r, "smtp")), mx=g(r, "mx"), website=site,
                audit={"has_site": bool(site)}, socials=socials,
                size={"SMALL": "Small", "MID": "Mid-size"}.get(g(r, "segment"), ""),
            )
            if o := sent_outreach(r):
                lead["outreach"] = o
            add(name[:-4], lead, OSM_CHECK)

    outbox = {}
    for r in rows("outbox_fr.csv"):
        e = g(r, "email").lower()
        if e:
            outbox[e] = r
    for r in rows("prospects_fr.csv"):
        email = g(r, "email")
        site = clean_site(g(r, "site"))
        has_site = bool(site) or g(r, "verdict") == "DROP_HAS_SITE"
        lead = base(
            name=g(r, "name"), niche="Hospitality", category=g(r, "type").replace("_", " "),
            country="FR", city=g(r, "city"), address=" ".join(x for x in (g(r, "street"), g(r, "postcode")) if x),
            lat=num(g(r, "lat")), lon=num(g(r, "lon")), phones=[g(r, "phone")] if g(r, "phone") else [],
            email=email, email_status=email_status(email, g(r, "smtp")), mx=g(r, "mx"), website=site,
            audit={"has_site": has_site}, socials={"facebook": g(r, "facebook")} if g(r, "facebook") else {},
        )
        ob = outbox.get(email.lower())
        if ob and g(ob, "sent"):
            optout = g(ob, "optout")
            status = "contacted"
            if optout:
                status = "not_interested" if re.search(r"declin|non merci|do-not-contact|wrong target|has a website", optout, re.I) else "replied"
            lead["outreach"] = {"status": status, "sent": g(ob, "sent")[:10], "channel": "email",
                                "campaign": "FR hospitality · free site", "note": optout or g(ob, "followup")}
        add("prospects_fr", lead, OSM_CHECK)

    for r in rows("hotels_alger.csv"):
        site = clean_site(g(r, "website"))
        socials = {k: g(r, k) for k in ("facebook", "instagram") if g(r, k)}
        add("hotels_alger", base(
            name=g(r, "name"), niche="Hospitality", category=g(r, "type").replace("_", " "), country="DZ",
            city="Alger", address=g(r, "address"), lat=num(g(r, "lat")), lon=num(g(r, "lon")),
            phones=[g(r, "phone")] if g(r, "phone") else [], website=site, audit={"has_site": bool(site)},
            socials=socials, maps={k: v for k, v in (("url", g(r, "maps")), ("rating", num(g(r, "rating")))) if v},
        ), ["OpenStreetMap"])

    for r in rows("dz30_candidates.csv"):
        email = g(r, "email")
        site = clean_site(g(r, "final", "site"))
        verdict = g(r, "verdict")
        lead = base(
            name=g(r, "name"), niche=niche_of(g(r, "cat")), category=g(r, "cat"), country="DZ", city=g(r, "city"),
            phones=[g(r, "phone")] if g(r, "phone") else [], email=email,
            email_status=email_status(email, verdict), website=site, audit=audit_from_bools(r, site),
        )
        if verdict == "ALREADY-CONTACTED":
            lead["outreach"]["status"] = "contacted"
        add("dz30_candidates", lead, OSM_CHECK + ["Website audit"])

    cars_sent = {g(r, "email").lower(): r for r in rows("alger_cars_sent_0913.csv")}
    for r in rows("alger_cars.csv"):
        email = g(r, "email")
        dom = g(r, "dom")
        s = cars_sent.get(email.lower())
        title = g(r, "title")
        name = g(s, "name") if s else (re.split(r"\s[|–\-:]\s", title)[0][:60] if title else dom)
        site = clean_site(g(r, "final") or dom)
        lead = base(
            name=name, niche="Car rental", category="car rental", country="DZ", city="Alger", email=email,
            other_emails=[e for e in g(r, "all_emails").split(";") if e and e != email and "john.doe" not in e],
            email_status=email_status(email, g(r, "verdict")), website=site, audit=audit_from_bools(r, site),
        )
        if s:
            lead["outreach"] = {"status": "contacted", "sent": g(s, "sent"), "channel": "email",
                                "campaign": "Alger car rental", "note": ""}
        elif g(r, "verdict") == "ALREADY-CONTACTED":
            lead["outreach"]["status"] = "contacted"
        add("alger_cars", lead, ["Web search", "Website crawl", "Website audit", "Email check"])

    for r in rows("adlib_prospects.csv"):
        email = g(r, "email")
        dom = g(r, "domain")
        site = clean_site(dom)
        title = g(r, "title")
        add("adlib_prospects", base(
            name=re.split(r"\s[|–:\-]\s|\s:\s", title)[0][:60] if title else dom, niche=niche_of(title),
            category=title[:80], country="CA" if dom.endswith(".ca") else "US", region="Québec" if dom.endswith(".ca") else "",
            email=email, other_emails=[e for e in g(r, "other_emails").split(";") if e],
            email_status=email_status(email, g(r, "smtp"), g(r, "verdict")), mx=g(r, "mx"), website=site,
            audit=audit_from_adlib(g(r, "flags"), site), ads=True,
        ), ["Meta Ad Library", "Website crawl", "Website audit", "Email check"])

    for r in rows("gulf_ca_sent.csv"):
        email = g(r, "email")
        city = g(r, "city")
        site = clean_site(g(r, "site"))
        add("gulf_ca_sent", base(
            name=g(r, "name"), niche="Dental", category="dental practice",
            country="AE" if city == "Dubai" else "CA", city=city, email=email,
            email_status=email_status(email, g(r, "verdict_final")), mx=g(r, "mx"), website=site,
            audit={"has_site": bool(site)}, maps={"reviews": int(num(g(r, "reviews")) or 0)} if num(g(r, "reviews")) else {},
            outreach={"status": "contacted", "sent": g(r, "sent"), "channel": "email",
                      "campaign": g(r, "angle_used"), "note": ""},
        ), ["Supplied list", "Website audit", "Email check"])

    for r in rows("dz60_found.csv"):
        email = g(r, "email")
        add("dz60_found", base(
            name=g(r, "nom"), niche=niche_of(g(r, "niche")), category=g(r, "niche"), country="DZ", city=g(r, "ville"),
            phones=[p.strip() for p in g(r, "telephones").split(";") if p.strip()], email=email,
            email_status="valid" if "verifi" in norm(g(r, "note")) else email_status(email),
        ), ["OpenStreetMap" if g(r, "source") in ("", "OSM") else g(r, "source"), "Email check"])

    for r in rows("dz60_candidates.csv"):
        email = g(r, "email")
        site = clean_site(g(r, "website"))
        add("dz60_candidates", base(
            name=g(r, "name"), niche=niche_of(g(r, "niche"), g(r, "kind")), category=g(r, "kind").replace("_", " "),
            country="DZ", city=g(r, "city"), phones=[g(r, "phone")] if g(r, "phone") else [], email=email,
            email_status=email_status(email, g(r, "verdict")), website=site, audit={"has_site": bool(site)},
        ), ["OpenStreetMap"])

    for r in rows("dz_appels.csv"):
        email = g(r, "email")
        lead = base(
            name=g(r, "name"), niche=niche_of(g(r, "speciality")), category=g(r, "speciality"), country="DZ",
            city=g(r, "city"), phones=[g(r, "phone")] if g(r, "phone") else [], email=email,
            email_status=email_status(email),
        )
        if g(r, "sent"):
            lead["outreach"] = {"status": "contacted", "sent": g(r, "sent")[:10], "channel": "phone",
                                "campaign": "DZ call list", "note": ""}
        add("dz_appels", lead, ["OpenStreetMap"])

    return out


# ---------------------------------------------------------------- merge + outreach logs

STATUS_RANK = {"new": 0, "contacted": 1, "replied": 2, "not_interested": 2, "won": 3}
EMAIL_RANK = {"none": 0, "unknown": 1, "invalid": 2, "risky": 3, "valid": 4}


def merge(leads):
    by_key = {}
    order = []
    for lead in leads:
        e = lead["email"].lower()
        if not lead["name"] and not e:
            continue
        key = ("e", e) if e else ("n", norm(lead["name"]), norm(lead["city"]))
        if key not in by_key:
            by_key[key] = lead
            order.append(key)
            continue
        cur = by_key[key]
        for k, v in lead.items():
            if k in ("sources", "datasets", "phones", "other_emails"):
                cur[k] = list(dict.fromkeys(cur[k] + v))
            elif k in ("audit", "maps", "socials"):
                cur[k] = {**v, **cur[k]}
            elif k == "email_status":
                if EMAIL_RANK[v] > EMAIL_RANK[cur[k]]:
                    cur[k] = v
            elif k == "outreach":
                if STATUS_RANK[v["status"]] > STATUS_RANK[cur[k]["status"]] or v["sent"] > cur[k]["sent"]:
                    cur[k] = {**cur[k], **{kk: vv for kk, vv in v.items() if vv}}
            elif cur[k] in (None, "", "Other") and v not in (None, ""):
                cur[k] = v
    return [by_key[k] for k in order]


def apply_sent_logs(leads):
    by_email = {l["email"].lower(): l for l in leads if l["email"]}
    for r in rows("dz_sent_0911.csv"):
        l = by_email.get(g(r, "email").lower())
        if l:
            l["outreach"] = {"status": "contacted", "sent": g(r, "sent"), "channel": "email", "campaign": g(r, "arm"), "note": ""}
    by_wa = {re.sub(r"\D", "", l["whatsapp"]): l for l in leads if l["whatsapp"]}
    for r in rows("dz_whatsapp_sent_0911.csv"):
        l = by_wa.get(re.sub(r"\D", "", g(r, "whatsapp")))
        if l:
            l["outreach"] = {"status": "contacted", "sent": g(r, "sent"), "channel": "whatsapp",
                             "campaign": "DZ WhatsApp · " + g(r, "version"), "note": ""}


# ---------------------------------------------------------------- scoring (rules, not AI)

def score(lead):
    """Rules v0. Three parts: can we reach them, do they have a visible gap, are they established."""
    reasons = []
    reach = 0
    es = lead["email_status"]
    if es == "valid":
        reach += 30; reasons.append(["+30", "Email verified — mailbox exists"])
    elif es in ("risky", "unknown"):
        reach += 12; reasons.append(["+12", "Email found but not fully verifiable"])
    elif es == "invalid":
        reasons.append(["0", "Email bounces or domain has no mail server"])
    if lead["phones"]:
        reach += 5; reasons.append(["+5", "Phone number available"])
    if lead["whatsapp"]:
        reach += 5; reasons.append(["+5", "WhatsApp number available"])
    reach = min(reach, 40)

    gap = 0
    a = lead["audit"]
    if a.get("has_site") is False:
        gap += 25; reasons.append(["+25", "No website"])
    else:
        if a.get("reachable") is False:
            gap += 20; reasons.append(["+20", "Website is down or unreachable"])
        for key, pts, text in (("booking", 8, "No online booking"), ("mobile", 8, "Site not mobile-friendly"),
                               ("https", 6, "Site has no HTTPS"), ("form", 5, "No contact form"),
                               ("chat", 4, "No chat on the site"), ("whatsapp", 3, "No WhatsApp button")):
            if a.get(key) is False:
                gap += pts; reasons.append([f"+{pts}", text])
        if a.get("slow") or (a.get("load_ms") or 0) > 4000:
            gap += 6; reasons.append(["+6", "Site loads slowly"])
    gap = min(gap, 40)

    est = 0
    m = lead["maps"]
    if (m.get("rating") or 0) >= 4:
        est += 6; reasons.append(["+6", f"Google rating {m['rating']:.1f}"])
    rv = m.get("reviews") or 0
    if rv >= 50:
        est += 10; reasons.append(["+10", f"{rv} Google reviews"])
    elif rv >= 10:
        est += 5; reasons.append(["+5", f"{rv} Google reviews"])
    if lead["ads"]:
        est += 10; reasons.append(["+10", "Running paid ads right now"])
    if lead["size"] == "Mid-size":
        est += 4; reasons.append(["+4", "Mid-size business"])
    est = min(est, 20)

    parts = {"reach": reach, "gap": gap, "established": est}
    if lead["outreach"]["status"] == "not_interested":
        reasons.append(["×", "Already declined — do not re-contact"])
        return 0, parts, reasons
    return reach + gap + est, parts, reasons


def main():
    raw = load_all()
    leads = merge(raw)
    apply_sent_logs(leads)
    for i, l in enumerate(leads, 1):
        l["id"] = f"L{i:05d}"
        l["score"], l["score_parts"], l["reasons"] = score(l)
        if not l["name"]:
            l["name"] = l["email"].split("@")[0] if l["email"] else l["website"]
    leads.sort(key=lambda l: -l["score"])
    datasets = Counter(d for l in raw for d in l["datasets"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rules_version": "v0",
        "datasets": [{"file": f + ".csv", "rows": n} for f, n in datasets.most_common()],
        "raw_rows": len(raw),
        "leads": leads,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"{len(raw)} rows -> {len(leads)} unique leads -> {OUT}")
    for label, fn in (("country", lambda l: l["country"]), ("niche", lambda l: l["niche"]),
                      ("email", lambda l: l["email_status"]), ("outreach", lambda l: l["outreach"]["status"])):
        print(label, dict(Counter(map(fn, leads)).most_common()))
    print("score buckets", dict(sorted(Counter(l["score"] // 20 * 20 for l in leads).items())))


if __name__ == "__main__":
    main()
