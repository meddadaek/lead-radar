"""Groq chat completions through its OpenAI-compatible API (free tier, no card)."""
import json
import re
import time

import requests

from .config import secret
from .http import Blocked, NeedsKey

BASE = "https://api.groq.com/openai/v1"
PREFERRED = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "llama-3.3-70b-versatile", "qwen/qwen3-32b", "openai/gpt-oss-20b"]
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
    name = model()
    reasoning_model = name.startswith("openai/gpt-oss")
    body: dict = {"model": name, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    if reasoning_model:
        # gpt-oss often writes its whole answer into `reasoning` and leaves `content` empty, which makes
        # Groq's JSON mode fail validation; ask for JSON in the prompt and read it back ourselves.
        body["reasoning_effort"] = "low"
        body["max_tokens"] = max(max_tokens, 3000)
    elif json_mode:
        body["response_format"] = {"type": "json_object"}
    r = None
    for attempt in range(5):
        r = requests.post(f"{BASE}/chat/completions", json=body, headers={"Authorization": f"Bearer {key}"}, timeout=90)
        # 400 "failed to generate/parse" is a one-off bad sample from the model: ask again
        malformed = r.status_code == 400 and re.search(r"json_validate_failed|tool_use_failed|could not be parsed", r.text)
        if r.status_code != 429 and not malformed:
            break
        if malformed:
            time.sleep(1)
            continue
        # free tier limits tokens per minute: wait as long as Groq asks (capped), then retry
        wait = r.headers.get("retry-after") or (re.search(r"try again in ([\d.]+)s", r.text) or [None, None])[1]
        time.sleep(min(60.0, float(wait) + 1) if wait else 15 * (attempt + 1))
    if r.status_code in (401, 403):
        raise Blocked("Groq rejected the key")
    if r.status_code == 429:
        raise Blocked("Groq free-tier rate limit reached; try again in a minute")
    if r.status_code >= 400:
        raise RuntimeError(f"Groq error {r.status_code}: {r.text[:200]}")
    message = r.json()["choices"][0]["message"]
    if not (message.get("content") or "").strip() and json_mode and message.get("reasoning"):
        found = parse_json(message["reasoning"])
        if found:
            message["content"] = json.dumps(found, ensure_ascii=False)
    return message


def parse_json(text: str) -> dict:
    """The last complete JSON object in the text (models sometimes wrap it in prose)."""
    text = text or ""
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        pass
    decoder, found = json.JSONDecoder(), {}
    for m in re.finditer(r"\{", text):
        try:
            obj, _ = decoder.raw_decode(text, m.start())
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            found = obj
    return found
