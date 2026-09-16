"""Tavily search API (free plan, email signup, no card). Supports restricting results to given domains."""
import requests

from ..config import secret
from ..http import Blocked, NeedsKey

URL = "https://api.tavily.com"


def available() -> bool:
    return bool(secret("TAVILY_API_KEY"))


def _headers() -> dict:
    key = secret("TAVILY_API_KEY")
    if not key:
        raise NeedsKey("Add your Tavily key in Settings")
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _check(r):
    if r.status_code in (401, 403):
        raise Blocked("Tavily rejected the key")
    if r.status_code in (429, 432, 433):
        raise Blocked("Tavily usage limit reached")
    r.raise_for_status()


def search(query: str, domains: list[str] | None = None, max_results: int = 8, depth: str = "basic") -> list[dict]:
    body = {"query": query, "max_results": max_results, "search_depth": depth, "include_answer": False}
    if domains:
        body["include_domains"] = domains
    r = requests.post(f"{URL}/search", json=body, headers=_headers(), timeout=40)
    _check(r)
    return [{"url": x.get("url", ""), "title": x.get("title") or "", "snippet": (x.get("content") or "")[:500]}
            for x in r.json().get("results", [])]


def extract(url: str) -> str:
    r = requests.post(f"{URL}/extract", json={"urls": [url]}, headers=_headers(), timeout=60)
    _check(r)
    results = r.json().get("results") or []
    return (results[0].get("raw_content") or "") if results else ""
