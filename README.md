# Lead Radar

A local lead-generation engine with a futuristic dashboard. Type a niche and a place; it finds the businesses, reads their websites, confirms each email with its mail server and each phone number, enriches them from public sources, scores the fit and skips everyone you have already contacted.

Everything runs on your own machine with free sources: no paid APIs, no card.

## What it does

1. **Discover** businesses for a niche in a city: Google Maps (headless browser), OpenStreetMap (Overpass), directories (PagesJaunes, Yellow Pages).
2. **Exclude** anything already in your past campaign files (matched by email, domain, phone and name + city).
3. **Find the website** when a listing has none (Brave Search in the browser, accepted only when the page matches the business's phone or name and city).
4. **Crawl the website** for emails, phones, WhatsApp and social links, and audit it: mobile, HTTPS, load time, online booking, contact form, live chat.
5. **Confirm contacts** without sending anything: email syntax → MX record → SMTP `RCPT TO` probe → catch-all test; phone numbers validated per country with libphonenumber. Businesses with no confirmed contact are not saved.
6. **Enrich**: French company registry (legal name, directors), domain age (RDAP, Wayback), LinkedIn company page and people, Facebook / Instagram / TikTok profiles, Doctolib booking pages, Trustpilot rating and complaints, Meta Ad Library (running ads), Apollo (with your own key), Reddit posts asking for the service.
7. **Score** each lead with transparent rules (reach 40 + visible gap 40 + established 20) and show why.

A **Test all sources** button runs every source live against a real business and shows which ones are working, partly working, blocked or waiting for a key.

## Stack

- `engine/` — Python 3.10+, FastAPI, Playwright (Chromium), dnspython, phonenumbers, SQLite
- `web/` — React 19, Vite, Tailwind CSS 4, Motion, React Three Fiber (3D globe of real lead coordinates)
- `importer/` — reads the old campaign CSVs to build the exclusion list

## Run it (Windows)

```bash
cd engine
python -m venv .venv
.venv\Scripts\python -m pip install fastapi "uvicorn[standard]" requests dnspython phonenumbers playwright
.venv\Scripts\python -m playwright install chromium
.venv\Scripts\python run.py            # API on http://127.0.0.1:8030
```

```bash
cd web
npm install
npm run dev                             # app on http://localhost:5317
```

Optional: put `APOLLO_API_KEY=...` in `engine/.env` to enable Apollo.

## Honest limits

- Facebook, Instagram and TikTok show little without a login, so the engine records profile links, not follower counts.
- Free web search tolerates little volume; each run has a fixed search budget and a human-check page is reported as "blocked".
- An email marked **Unconfirmable** means the mail server accepts every address or refuses to answer; only **Verified** means the mailbox was confirmed.
- Lead data stays local in `data/` and is never committed.
