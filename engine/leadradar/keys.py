"""API keys the user adds from the Settings page. Stored only in engine/.env on this machine."""
import re

from .config import ENGINE, secret

ENV = ENGINE / ".env"

KEYS = [
    {"name": "TAVILY_API_KEY", "label": "Tavily", "free": "1,000 searches / month · no card",
     "url": "https://app.tavily.com/home",
     "unlocks": ["Web search", "LinkedIn", "Instagram", "Facebook", "TikTok", "Reddit", "Trustpilot", "Doctolib", "AI agent"]},
    {"name": "GROQ_API_KEY", "label": "Groq · AI agent", "free": "Free tier · no card",
     "url": "https://console.groq.com/keys", "unlocks": ["AI agent"]},
    {"name": "APOLLO_API_KEY", "label": "Apollo", "free": "Free plan credits",
     "url": "https://app.apollo.io/#/settings/integrations/api", "unlocks": ["Apollo"]},
    {"name": "HUNTER_API_KEY", "label": "Hunter", "free": "25 domain searches / month",
     "url": "https://hunter.io/api-keys", "unlocks": ["Hunter"]},
    {"name": "REDDIT_CLIENT_ID", "label": "Reddit app ID", "free": "Free · create a 'script' app",
     "url": "https://www.reddit.com/prefs/apps", "unlocks": ["Reddit"]},
    {"name": "REDDIT_CLIENT_SECRET", "label": "Reddit app secret", "free": "Free · same app",
     "url": "https://www.reddit.com/prefs/apps", "unlocks": ["Reddit"]},
]
NAMES = {k["name"] for k in KEYS}


def status() -> list[dict]:
    out = []
    for k in KEYS:
        v = secret(k["name"])
        out.append({**k, "set": bool(v), "hint": f"…{v[-4:]}" if len(v) >= 8 else ("set" if v else "")})
    return out


def save(name: str, value: str) -> None:
    if name not in NAMES:
        raise ValueError("Unknown key")
    value = (value or "").strip()
    if re.search(r"[\r\n=\s]", value):
        raise ValueError("A key can't contain spaces, '=' or line breaks")
    lines = ENV.read_text(encoding="utf-8").splitlines() if ENV.exists() else []
    lines = [l for l in lines if not re.match(rf"\s*{re.escape(name)}\s*=", l)]
    if value:
        lines.append(f"{name}={value}")
    ENV.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
