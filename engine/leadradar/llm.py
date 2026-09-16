"""Groq chat completions through its OpenAI-compatible API (free tier, no card)."""
import json
import re
import time

import requests

from .config import secret
from .http import Blocked, NeedsKey

BASE = "https://api.groq.com/openai/v1"
PREFERRED = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "meta-llama/llama-4-maverick-17b-128e-instruct",
             "qwen/qwen3-32b", "llama-3.1-8b-instant"]
_models: dict[str, str] = {}


def available() -> bool:
    return bool(secret("GROQ_API_KEY"))


def _key() -> str:
    key = secret("GROQ_API_KEY")
    if not key:
        raise NeedsKey("Add your Groq key in Settings to use the AI agent")
    return key


def model() -> str:
    key = _key()
    if key in _models:
        return _models[key]
    r = requests.get(f"{BASE}/models", headers={"Authorization": f"Bearer {key}"}, timeout=20)
    if r.status_code in (401, 403):
        raise Blocked("Groq rejected the key")
    ids = {m["id"] for m in r.json().get("data", [])} if r.ok else set()
    override = secret("LLM_MODEL")
    pick = override if override and override in ids else next((m for m in PREFERRED if m in ids), None) or PREFERRED[0]
    _models[key] = pick
    return pick


def chat(messages: list[dict], tools: list[dict] | None = None, json_mode: bool = False,
         temperature: float = 0.2, max_tokens: int = 1800) -> dict:
    key = _key()
    body: dict = {"model": model(), "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    r = None
    for attempt in range(3):
        r = requests.post(f"{BASE}/chat/completions", json=body, headers={"Authorization": f"Bearer {key}"}, timeout=90)
        if r.status_code != 429:
            break
        time.sleep(5 * (attempt + 1))
    if r.status_code in (401, 403):
        raise Blocked("Groq rejected the key")
    if r.status_code == 429:
        raise Blocked("Groq free-tier rate limit reached; try again in a minute")
    if r.status_code >= 400:
        raise RuntimeError(f"Groq error {r.status_code}: {r.text[:200]}")
    return r.json()["choices"][0]["message"]


def parse_json(text: str) -> dict:
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        m = re.search(r"\{.*\}", text or "", re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    return {}
