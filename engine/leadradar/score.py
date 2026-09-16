"""Fit score, rules v1 (not AI): can we reach them (40) + a visible gap to fix (40) + an established business (20)."""
from datetime import datetime, timezone


def score(lead: dict) -> tuple[int, dict, list[list[str]]]:
    reasons: list[list[str]] = []
    reach = 0
    es = lead["email_status"]
    if es == "valid":
        reach += 30
        reasons.append(["+30", "Email confirmed by its mail server"])
    elif es == "risky":
        reach += 12
        reasons.append(["+12", "Email found, server won't confirm the mailbox"])
    phones = lead.get("checks", {}).get("phones", [])
    if phones:
        reach += 6
        reasons.append(["+6", f"{len(phones)} valid phone number{'s' if len(phones) > 1 else ''}"])
    if lead["whatsapp"]:
        reach += 4
        reasons.append(["+4", "WhatsApp link on their site"])
    reach = min(reach, 40)

    gap = 0
    a = lead["audit"]
    if a.get("has_site") is False:
        gap += 25
        reasons.append(["+25", "No website"])
    else:
        if a.get("reachable") is False:
            gap += 20
            reasons.append(["+20", "Website is down"])
        for key, pts, text in (("booking", 8, "No online booking"), ("mobile", 8, "Site not mobile-friendly"),
                               ("https", 6, "No HTTPS"), ("form", 5, "No contact form"), ("chat", 4, "No live chat")):
            if a.get(key) is False:
                gap += pts
                reasons.append([f"+{pts}", text])
        if (a.get("load_ms") or 0) > 4000:
            gap += 6
            reasons.append(["+6", f"Slow site ({a['load_ms'] / 1000:.1f}s)"])
    tp = lead.get("trustpilot") or {}
    if tp.get("complaints"):
        gap += 4
        reasons.append(["+4", "Low-star reviews mention problems"])
    gap = min(gap, 40)

    est = 0
    m = lead["maps"]
    if (m.get("rating") or 0) >= 4:
        est += 5
        reasons.append(["+5", f"Google rating {m['rating']:.1f}"])
    rv = m.get("reviews") or 0
    if rv >= 50:
        est += 8
        reasons.append(["+8", f"{rv} Google reviews"])
    elif rv >= 10:
        est += 4
        reasons.append(["+4", f"{rv} Google reviews"])
    if lead.get("ads"):
        est += 8
        reasons.append(["+8", "Running Meta ads right now"])
    created = (lead.get("domain") or {}).get("registered")
    if created:
        try:
            years = (datetime.now(timezone.utc) - datetime.fromisoformat(created.replace("Z", "+00:00"))).days / 365
            if years >= 5:
                est += 3
                reasons.append(["+3", f"Domain registered {int(years)} years ago"])
        except ValueError:
            pass
    if lead.get("people"):
        est += 3
        reasons.append(["+3", "Decision maker identified"])
    if (tp.get("reviews") or 0) > 0:
        est += 2
        reasons.append(["+2", f"{tp['reviews']} Trustpilot reviews"])
    est = min(est, 20)

    return reach + gap + est, {"reach": reach, "gap": gap, "established": est}, reasons
