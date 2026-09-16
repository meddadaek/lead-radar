"""Read a business website: contacts, social links and a quick audit."""
import html as H
import re
import time
from urllib.parse import urljoin, urlparse

import phonenumbers
import requests

from .http import get
from .known import host_of, norm

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,24}")
JUNK = re.compile(
    r"example|exemple|sentry|wixpress|godaddy|domain\.com|yourdomain|votre|no-?reply|\.(png|jpe?g|gif|webp|svg|js|css)$|"
    r"@2x|^test@|^user@|^name@|^nom@|^email@|u00|wixsite|cloudflare|schema\.org|\.wix\.com$", re.I)
SOCIAL = {
    "facebook": re.compile(r"https?://(?:www\.|m\.|web\.)?facebook\.com/(?!sharer|share|dialog|plugins|tr\b|events)[A-Za-z0-9._\-/%]+", re.I),
    "instagram": re.compile(r"https?://(?:www\.)?instagram\.com/(?!p/|reel/|explore)[A-Za-z0-9._]+", re.I),
    "linkedin": re.compile(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/(?:company|in|school)/[A-Za-z0-9._\-%]+", re.I),
    "tiktok": re.compile(r"https?://(?:www\.)?tiktok\.com/@[A-Za-z0-9._]+", re.I),
    "youtube": re.compile(r"https?://(?:www\.)?youtube\.com/(?:@|channel/|c/|user/)[A-Za-z0-9._\-]+", re.I),
    "x": re.compile(r"https?://(?:www\.)?(?:twitter|x)\.com/(?!intent|share|home)[A-Za-z0-9_]+", re.I),
}
WHATSAPP = re.compile(r"(?:wa\.me/|api\.whatsapp\.com/send/?\?phone=|whatsapp://send\?phone=)\+?(\d{8,15})", re.I)
BOOKING = re.compile(
    r"book(?:ing)?\s*(?:online|now|an?\s+appointment)|prendre\s+rendez[- ]vous|rendez[- ]vous\s+en\s+ligne|"
    r"r[ée]serv(?:er|ation)\s+en\s+ligne|doctolib\.|calendly\.|planity\.|booksy\.|setmore\.|simplybook|treatwell\.", re.I)
CHAT = re.compile(
    r"tawk\.to|crisp\.chat|intercom|drift\.com|livechatinc|tidio|zdassets|zopim|hs-scripts|freshchat|chatra|smartsupp|"
    r"getbutton\.io|whatsapp[- ]?(?:chat|widget|button)", re.I)
CONTACT_LINK = re.compile(r"contact|joindre|about|a-propos|qui-sommes|mentions|legal|impressum|kontakt|equipe|team", re.I)
DEFAULT_PATHS = ["/contact", "/contact-us", "/contactez-nous", "/mentions-legales"]
STOP = {"cabinet", "dentaire", "centre", "center", "clinic", "clinique", "docteur", "hotel", "restaurant", "agence",
        "societe", "group", "groupe", "services", "service", "sarl", "eurl", "dental", "medical", "office"}


def visible_text(html: str) -> str:
    html = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html)
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", html))).strip()


def fetch(url: str):
    t0 = time.monotonic()
    try:
        r = get(url, timeout=12, allow_redirects=True)
        if "html" not in r.headers.get("content-type", "html"):
            return r.url, r.status_code, "", None
        return r.url, r.status_code, r.text[:1_500_000], int((time.monotonic() - t0) * 1000)
    except requests.RequestException:
        return url, 0, "", None


def crawl(website: str, region: str, max_pages: int = 5) -> dict:
    out = {"reachable": False, "final_url": "", "https": None, "mobile": None, "booking": None, "form": None,
           "chat": None, "load_ms": None, "title": "", "emails": {}, "phones": {}, "socials": {}, "whatsapp": "",
           "text": ""}
    start = website if website.startswith("http") else "https://" + website
    final, status, html, ms = fetch(start)
    if status == 0 and start.startswith("https://"):
        final, status, html, ms = fetch("http://" + start[len("https://"):])
    if not (200 <= status < 400) or not html:
        return out
    out.update(reachable=True, final_url=final, https=final.startswith("https://"), load_ms=ms)

    host = host_of(final)
    extra: list[str] = []
    for href, label in re.findall(r'<a[^>]+href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', html, re.I | re.S):
        u = urljoin(final, H.unescape(href))
        if host_of(u) == host and u.rstrip("/") != final.rstrip("/") and u not in extra and \
                (CONTACT_LINK.search(href) or CONTACT_LINK.search(re.sub(r"<[^>]+>", "", label))):
            extra.append(u)
    if not extra:
        p = urlparse(final)
        extra = [f"{p.scheme}://{p.netloc}{path}" for path in DEFAULT_PATHS]

    pages = [(final, html)]
    for u in extra[: max_pages - 1]:
        f2, s2, h2, _ = fetch(u)
        if 200 <= s2 < 300 and h2:
            pages.append((f2, h2))
        time.sleep(0.2)

    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    out["title"] = re.sub(r"\s+", " ", H.unescape(m.group(1))).strip()[:120] if m else ""
    out["mobile"] = bool(re.search(r"<meta[^>]+name=[\"']viewport", html, re.I))
    joined = "\n".join(h for _, h in pages)
    out["booking"] = bool(BOOKING.search(joined))
    out["form"] = bool(re.search(r"<form\b", joined, re.I))
    out["chat"] = bool(CHAT.search(joined))

    for page_url, h in pages:
        text = visible_text(h)
        deobf = re.sub(r"\s*[\[\(\{]\s*(?:at|arobase)\s*[\]\)\}]\s*", "@", text, flags=re.I)
        for e in EMAIL_RE.findall(H.unescape(h) + " " + deobf):
            e = e.lower().strip(".")
            if not JUNK.search(e) and len(e) <= 64:
                out["emails"].setdefault(e, page_url)
        candidates = re.findall(r'href=["\']tel:([^"\']+)', h, re.I)
        for raw in candidates:
            try:
                n = phonenumbers.parse(raw, region or None)
                if phonenumbers.is_valid_number(n):
                    out["phones"].setdefault(phonenumbers.format_number(n, phonenumbers.PhoneNumberFormat.E164), page_url)
            except phonenumbers.NumberParseException:
                pass
        for match in phonenumbers.PhoneNumberMatcher(text[:120_000], region or None, leniency=phonenumbers.Leniency.VALID):
            out["phones"].setdefault(phonenumbers.format_number(match.number, phonenumbers.PhoneNumberFormat.E164), page_url)
        for name, rx in SOCIAL.items():
            hit = rx.search(h)
            if hit and name not in out["socials"]:
                out["socials"][name] = hit.group(0).rstrip("/")
        wa = WHATSAPP.search(h)
        if wa and not out["whatsapp"]:
            out["whatsapp"] = "+" + wa.group(1)
    out["text"] = visible_text(html)[:5000]
    return out


def site_matches(name: str, city: str, phones: list[str], site: dict) -> bool:
    """Is this website really the business? Phone match wins; otherwise name tokens plus city."""
    if not site.get("reachable"):
        return False
    wanted = {re.sub(r"\D", "", p)[-9:] for p in phones if len(re.sub(r"\D", "", p)) >= 8}
    found = {re.sub(r"\D", "", p)[-9:] for p in site["phones"]}
    if wanted & found:
        return True
    hay = norm(site["title"] + " " + site["text"]) + " " + host_of(site["final_url"]).replace(".", " ").replace("-", " ")
    tokens = [t for t in norm(name).split() if len(t) >= 4 and t not in STOP]
    if not tokens:
        return False
    hits = sum(1 for t in tokens if t in hay)
    need = 1 if len(tokens) == 1 else 2
    return hits >= need and (not city or norm(city) in hay or hits >= 2)
