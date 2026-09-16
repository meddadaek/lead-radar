"""Web search through Brave Search in the shared headless browser.

Plain HTTP requests get rate-limited by Brave (429) and Bing serves decoy
results to scripts, so searches run in the real browser, one at a time with a
pause. A human-check page raises Blocked so the UI can say so.
"""
import re
import urllib.parse

from ..http import Blocked, Throttle
from .browser import browser

_throttle = Throttle(4.0)
SKIP = re.compile(r"(^|\.)(brave\.com|bravesoftware\.com|google\.[a-z.]+|gstatic\.com)$", re.I)

_EXTRACT = """() => {
  const out = [], seen = new Set();
  const push = (a, t, d) => { if (!a || seen.has(a.href)) return; seen.add(a.href);
    out.push({ url: a.href, title: (t || a.innerText || '').trim().split('\\n')[0], snippet: (d || '').trim() }); };
  document.querySelectorAll('[data-type="web"]').forEach(el => {
    const a = el.querySelector('a[href^="http"]');
    const t = el.querySelector('.title, .search-snippet-title, [class*="title"]');
    const d = el.querySelector('.snippet-description, [class*="description"], .content');
    push(a, t && t.innerText, d && d.innerText);
  });
  if (!out.length) document.querySelectorAll('#results a[href^="http"], main a[href^="http"]').forEach(a => {
    if (a.innerText.trim().length > 12) push(a, a.innerText, '');
  });
  return out;
}"""


def search(query: str, country: str = "", count: int = 10) -> list[dict]:
    url = "https://search.brave.com/search?source=web&q=" + urllib.parse.quote(query)
    if country:
        url += "&country=" + country.lower()

    def job(page):
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(1800)
        head = page.inner_text("body")[:800].lower()
        if "robot" in head and ("vérification" in head or "verify" in head or "captcha" in head):
            raise Blocked("Brave Search asked for a human check")
        return page.evaluate(_EXTRACT)

    with _throttle:
        items = browser.run(job, timeout=90)
    out, seen = [], set()
    for it in items:
        host = urllib.parse.urlparse(it["url"]).hostname or ""
        if SKIP.search(host) or it["url"] in seen:
            continue
        seen.add(it["url"])
        out.append(it)
    return out[:count]
