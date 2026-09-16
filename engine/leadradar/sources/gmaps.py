"""Google Maps through a headless browser: rating, reviews, phone, website, address. No key."""
import re
import urllib.parse

from ..http import Blocked
from .browser import browser


def _consent(page):
    if "consent." in page.url:
        for label in ("Reject all", "Tout refuser", "Alle ablehnen", "Rechazar todo", "Rifiuta tutto"):
            button = page.get_by_role("button", name=label)
            if button.count():
                button.first.click()
                page.wait_for_load_state("domcontentloaded")
                return


def search(query: str, limit: int = 40) -> list[str]:
    def job(page):
        page.goto("https://www.google.com/maps/search/" + urllib.parse.quote(query) + "?hl=en",
                  wait_until="domcontentloaded", timeout=45000)
        _consent(page)
        try:
            page.wait_for_selector('div[role="feed"], h1.DUwDvf', timeout=20000)
        except Exception as e:  # noqa: BLE001
            if "sorry" in page.url or "captcha" in page.content().lower():
                raise Blocked("Google Maps showed a captcha") from e
            return []
        feed = page.locator('div[role="feed"]')
        if feed.count() == 0:
            return [page.url]
        links: dict[str, None] = {}
        stale = 0
        for _ in range(30):
            before = len(links)
            for a in page.locator("a.hfpxzc").all():
                href = a.get_attribute("href")
                if href:
                    links[href] = None
            if len(links) >= limit:
                break
            stale = stale + 1 if len(links) == before else 0
            if stale >= 3 or page.get_by_text("You've reached the end of the list").count():
                break
            feed.evaluate("el => el.scrollBy(0, el.scrollHeight)")
            page.wait_for_timeout(1300)
        return list(links)[:limit]

    return browser.run(job, timeout=240)


def details(urls: list[str]) -> list[dict]:
    def job(page):
        out = []
        for url in urls:
            try:
                page.goto(url + ("&hl=en" if "?" in url else "?hl=en"), wait_until="domcontentloaded", timeout=40000)
                _consent(page)
                page.wait_for_selector("h1", timeout=15000)
                page.wait_for_timeout(800)

                def attr(selector, name):
                    loc = page.locator(selector).first
                    return loc.get_attribute(name) if loc.count() else None

                def text(selector):
                    loc = page.locator(selector).first
                    return loc.inner_text().strip() if loc.count() else ""

                rating = reviews = None
                try:
                    rating = float(text('div.F7nice span[aria-hidden="true"]').replace(",", "."))
                except ValueError:
                    pass
                label = attr('div.F7nice span[aria-label*="review"]', "aria-label") or ""
                if re.sub(r"\D", "", label):
                    reviews = int(re.sub(r"\D", "", label))
                phone_id = attr('button[data-item-id^="phone:tel:"]', "data-item-id") or ""
                coords = re.search(r"!3d(-?[\d.]+)!4d(-?[\d.]+)", page.url) or re.search(r"!3d(-?[\d.]+)!4d(-?[\d.]+)", url)
                address = (attr('button[data-item-id="address"]', "aria-label") or "").split(":", 1)[-1].strip()
                out.append({
                    "key": "gmaps:" + (re.search(r"!1s(0x[0-9a-f]+:0x[0-9a-f]+)", url) or re.search(r"(.*)", url)).group(1)[:120],
                    "name": text("h1"),
                    "category": text("button.DkEaL"),
                    "lat": float(coords.group(1)) if coords else None,
                    "lon": float(coords.group(2)) if coords else None,
                    "phones": [phone_id.split("phone:tel:", 1)[1]] if phone_id else [],
                    "emails": [],
                    "website": attr('a[data-item-id="authority"]', "href") or "",
                    "address": address,
                    "postcode": "",
                    "city": "",
                    "socials": {},
                    "maps": {k: v for k, v in (("rating", rating), ("reviews", reviews), ("url", url)) if v},
                    "sources": ["Google Maps"],
                })
            except Exception:  # noqa: BLE001 - one broken place page shouldn't sink the batch
                continue
        return out

    return browser.run(job, timeout=60 + 30 * len(urls))
