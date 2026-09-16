"""Confirm contacts without sending anything.

Email: syntax -> MX record -> SMTP RCPT probe (the conversation stops before any
message is sent) -> catch-all test with a random address on the same domain.
Phone: parsed and validated for the country with Google's libphonenumber rules.
"""
import re
import smtplib
import socket
import threading
import time
import uuid
from datetime import datetime, timezone

import dns.resolver
import phonenumbers

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,24}$")
# Big providers answer honestly per mailbox; skip the catch-all probe for them.
HONEST = re.compile(r"^(gmail|googlemail|outlook|hotmail|live)\.", re.I)
# Yahoo/AOL accept every RCPT, so a 250 there proves nothing.
ACCEPT_ALL = re.compile(r"^(yahoo|ymail|aol)\.", re.I)

_resolver = dns.resolver.Resolver()
_resolver.timeout, _resolver.lifetime = 5, 8
_mx_cache: dict[str, list[str]] = {}
_catch_cache: dict[str, bool] = {}
_host_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


def mx_hosts(domain: str) -> list[str]:
    if domain in _mx_cache:
        return _mx_cache[domain]
    hosts: list[str] = []
    try:
        hosts = [r.exchange.to_text().rstrip(".") for r in sorted(_resolver.resolve(domain, "MX"), key=lambda r: r.preference)]
    except Exception:
        try:
            _resolver.resolve(domain, "A")
            hosts = [domain]
        except Exception:
            hosts = []
    _mx_cache[domain] = hosts
    return hosts


# A 5xx is only proof the mailbox is missing when it talks about the mailbox. Rejections about
# *us* (blocklisted IP, sender policy) say nothing about the address and must not mark it invalid.
MAILBOX_MISSING = re.compile(r"5\.1\.[0-6]|user unknown|unknown user|no such (user|mailbox|recipient)|does not exist|"
                             r"doesn't exist|not exist|recipient (address )?rejected|invalid (recipient|mailbox|address)|"
                             r"mailbox (unavailable|not found)|address not found|undeliverable|not a valid", re.I)
BLOCKED = re.compile(r"5\.7\.\d+|spamhaus|blocked|block list|blocklist|blacklist|black list|policy|denied|"
                     r"sender address rejected|client host|reputation|not allowed|access denied|rbl|dnsbl", re.I)


def classify(code: int | None, message: str) -> str:
    """'accepted' | 'missing' | 'blocked' (refused to tell us) | 'unknown'."""
    if code in (250, 251):
        return "accepted"
    if code is None or code < 500:
        return "unknown"
    if BLOCKED.search(message) and not re.search(r"5\.1\.[0-6]", message):
        return "blocked"
    if MAILBOX_MISSING.search(message) or code in (550, 551, 553):
        return "missing"
    return "unknown"


def _probe(host: str, addresses: list[str]) -> list[tuple[int | None, str]]:
    """One SMTP session, several RCPT TO checks. (None, reason) = could not ask."""
    with _guard:
        lock = _host_locks.setdefault(host, threading.Lock())
    with lock:
        try:
            s = smtplib.SMTP(timeout=12)
            code, msg = s.connect(host, 25)
            if code != 220:
                s.close()
                return [(None, msg.decode("utf-8", "ignore"))] * len(addresses)
            s.helo("mail.localhost")
            # empty envelope sender (the bounce address): accepted by servers that reject made-up sender domains
            code, msg = s.mail("")
            if code >= 400:
                s.close()
                return [(code, msg.decode("utf-8", "ignore"))] * len(addresses)
            out: list[tuple[int | None, str]] = []
            for a in addresses:
                c, m = s.rcpt(a)
                out.append((c, m.decode("utf-8", "ignore")))
            try:
                s.quit()
            except Exception:
                pass
            time.sleep(0.3)
            return out
        except (smtplib.SMTPException, socket.error, OSError) as e:
            return [(None, type(e).__name__)] * len(addresses)


def hunter_verify(address: str) -> dict | None:
    """Hunter runs the mailbox check from its own servers (used when ours are refused). None if unavailable."""
    from .config import secret

    key = secret("HUNTER_API_KEY")
    if not key:
        return None
    import requests

    for _ in range(3):
        try:
            r = requests.get("https://api.hunter.io/v2/email-verifier", params={"email": address, "api_key": key}, timeout=40)
        except requests.RequestException:
            return None
        if r.status_code == 202:  # still verifying on Hunter's side
            time.sleep(4)
            continue
        if r.status_code != 200:
            return {"error": f"Hunter {r.status_code}"}
        d = r.json().get("data") or {}
        status, result = d.get("status"), d.get("result")
        if status == "valid" or (status == "webmail" and result == "deliverable"):
            return {"verdict": "valid", "reason": "Mailbox confirmed by Hunter's verifier"}
        if status == "invalid" or result == "undeliverable":
            return {"verdict": "invalid", "reason": "Hunter's verifier says this mailbox does not exist"}
        if status == "accept_all":
            return {"verdict": "risky", "reason": "Server accepts every address (checked by Hunter)", "catch_all": True}
        return {"verdict": "risky", "reason": f"Hunter couldn't confirm it ({status or 'unknown'})"}
    return None


def verify_email(address: str) -> dict:
    address = (address or "").strip().lower()
    out = {"address": address, "verdict": "invalid", "reason": "", "mx": "", "smtp": None,
           "catch_all": None, "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    if not EMAIL_RE.match(address):
        out["reason"] = "Not a valid email format"
        return out
    domain = address.split("@", 1)[1]
    hosts = mx_hosts(domain)
    if not hosts:
        out["reason"] = "Domain has no mail server"
        return out
    out["mx"] = hosts[0]
    probe_catch = not HONEST.match(domain) and domain not in _catch_cache
    fake = f"lr-{uuid.uuid4().hex[:12]}@{domain}"
    replies: list[tuple[int | None, str]] = [(None, "")]
    for host in hosts[:2]:
        replies = _probe(host, [address, fake] if probe_catch else [address])
        if replies[0][0] is not None:
            out["mx"] = host
            break
    code, message = replies[0]
    kind = classify(code, message)
    out["smtp"], out["smtp_reply"] = code, message[:160]
    if probe_catch and len(replies) > 1:
        fake_kind = classify(*replies[1])
        if fake_kind in ("accepted", "missing"):  # only a mailbox-level answer tells us anything
            _catch_cache[domain] = fake_kind == "accepted"
    catch_all = True if ACCEPT_ALL.match(domain) else _catch_cache.get(domain)
    out["catch_all"] = catch_all
    if kind == "accepted":
        if catch_all:
            out["verdict"], out["reason"] = "risky", "Server accepts every address, so this one can't be proven"
        else:
            out["verdict"], out["reason"] = "valid", "Mailbox confirmed by the mail server"
        return out
    if kind == "missing":
        out["verdict"], out["reason"] = "invalid", "Mail server says this mailbox does not exist"
        return out

    # blocked or no answer: our connection can't prove anything, so ask Hunter's verifier
    out["verdict"] = "risky"
    out["reason"] = ("Mail server refuses checks from this internet connection (IP blocklisted)" if kind == "blocked"
                     else "Mail server would not confirm (greylisting or no answer)")
    h = hunter_verify(address)
    if h and "verdict" in h:
        out.update(verdict=h["verdict"], reason=h["reason"], via="Hunter")
        if "catch_all" in h:
            out["catch_all"] = h["catch_all"]
    elif h and h.get("error"):
        out["reason"] += f" · Hunter verifier unavailable ({h['error']})"
    return out


def verify_phone(raw: str, region: str) -> dict | None:
    try:
        num = phonenumbers.parse(raw, (region or "").upper() or None)
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_valid_number(num):
        return None
    kind = phonenumbers.number_type(num)
    return {
        "e164": phonenumbers.format_number(num, phonenumbers.PhoneNumberFormat.E164),
        "display": phonenumbers.format_number(num, phonenumbers.PhoneNumberFormat.INTERNATIONAL),
        "type": {phonenumbers.PhoneNumberType.MOBILE: "mobile", phonenumbers.PhoneNumberType.FIXED_LINE: "landline",
                 phonenumbers.PhoneNumberType.FIXED_LINE_OR_MOBILE: "landline or mobile"}.get(kind, "other"),
        "region": phonenumbers.region_code_for_number(num),
    }
