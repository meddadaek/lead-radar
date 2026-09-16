"""Web search: Tavily when its key is set (reliable, supports domain filters), otherwise Brave in the browser.

Brave needs no key but tolerates little volume and ignores `site:`, so domain
filters become plain keywords there and results are filtered by host afterwards.
"""
import re
import urllib.parse

from ..http import Blocked, Throttle
from . import tavily
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


def engine_name() -> str:
    return "Tavily" if tavily.available() else "Brave (no key)"


def _on_domain(url: str, domains: list[str]) -> bool:
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    return any(host == d or host.endswith("." + d) for d in domains)


def search(query: str, country: str = "", count: int = 10, domains: list[str] | None = None) -> list[dict]:
    if tavily.available():
        return tavily.search(query, domains, max_results=min(count, 20))

    q = query + (" " + " ".join(d.split(".")[0] for d in domains) if domains else "")
    url = "https://search.brave.com/search?source=web&q=" + urllib.parse.quote(q)
    if country:
        url += "&country=" + country.lower()

    def job(page):
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(1800)
        head = page.inner_text("body")[:800].lower()
        if "robot" in head and ("vérification" in head or "verify" in head or "captcha" in head):
            raise Blocked("Brave Search asked for a human check (add a Tavily key in Settings)")
        return page.evaluate(_EXTRACT)

    with _throttle:
        items = browser.run(job, timeout=90)
    out, seen = [], set()
    for it in items:
        host = urllib.parse.urlparse(it["url"]).hostname or ""
        if SKIP.search(host) or it["url"] in seen or (domains and not _on_domain(it["url"], domains)):
            continue
        seen.add(it["url"])
        out.append(it)
    return out[:count]
