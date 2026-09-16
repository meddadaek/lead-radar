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


def _probe(host: str, addresses: list[str]) -> list[int | None]:
    """One SMTP session, several RCPT TO checks. None = could not ask."""
    with _guard:
        lock = _host_locks.setdefault(host, threading.Lock())
    with lock:
        try:
            s = smtplib.SMTP(timeout=12)
            code, _ = s.connect(host, 25)
            if code != 220:
                s.close()
                return [None] * len(addresses)
            s.helo("mail.example.com")
            s.mail("verify@example.com")
            codes: list[int | None] = []
            for a in addresses:
                c, _ = s.rcpt(a)
                codes.append(c)
            try:
                s.quit()
            except Exception:
                pass
            time.sleep(0.3)
            return codes
        except (smtplib.SMTPException, socket.error, OSError):
            return [None] * len(addresses)


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
    codes: list[int | None] = [None]
    for host in hosts[:2]:
        codes = _probe(host, [address, fake] if probe_catch else [address])
        if codes[0] is not None:
            out["mx"] = host
            break
    code = codes[0]
    out["smtp"] = code
    if probe_catch and len(codes) > 1 and codes[1] is not None:
        _catch_cache[domain] = codes[1] in (250, 251)
    catch_all = True if ACCEPT_ALL.match(domain) else _catch_cache.get(domain)
    out["catch_all"] = catch_all
    if code in (250, 251):
        if catch_all:
            out["verdict"], out["reason"] = "risky", "Server accepts every address, so this one can't be proven"
        else:
            out["verdict"], out["reason"] = "valid", "Mailbox confirmed by the mail server"
    elif code in (550, 551, 553):
        out["verdict"], out["reason"] = "invalid", "Mail server says this mailbox does not exist"
    else:
        out["verdict"], out["reason"] = "risky", "Mail server would not confirm (greylisting or blocking checks)"
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
