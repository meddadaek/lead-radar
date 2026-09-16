"""HTTP API for the Lead Radar web app (http://127.0.0.1:8030)."""
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import agent, chat, db, health, keys, llm, pipeline
from .http import Blocked, NeedsKey
from .known import archive
from .sources import websearch


@asynccontextmanager
async def lifespan(_app: FastAPI):
    for s in db.list_searches():
        if s["state"] == "running":
            db.update_search(s["id"], state="error", last_error="Engine restarted during the run")
    threading.Thread(target=archive, daemon=True).start()  # warm the exclusion list
    yield


app = FastAPI(title="Lead Radar engine", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5317", "http://127.0.0.1:5317"],
                   allow_methods=["*"], allow_headers=["*"])


class SearchIn(BaseModel):
    niche: str = Field(min_length=2, max_length=80)
    location: str = Field(min_length=2, max_length=120)
    country: str = Field(min_length=2, max_length=2)
    limit: int = Field(50, ge=5, le=500)
    sources: list[str] = []
    run: bool = True


@app.get("/api/health")
def get_health():
    return {"ok": True, "running": pipeline.running(), "testing_sources": health.is_running()}


@app.get("/api/leads")
def get_leads():
    arch = archive()
    return {"generated_at": db.now(), "rules_version": "v1",
            "known": {"businesses": arch["businesses"], "files": arch["files"]}, "leads": db.all_leads()}


@app.get("/api/searches")
def get_searches():
    live = set(pipeline.running())
    return [{**s, "running": s["id"] in live, "events": db.events(s["id"], 40)} for s in db.list_searches()]


@app.post("/api/searches")
def create_search(body: SearchIn):
    params = body.model_dump(exclude={"run"})
    params["country"] = params["country"].upper()
    s = db.add_search(params)
    if body.run:
        pipeline.start(s["id"])
    return db.get_search(s["id"])


@app.post("/api/searches/{sid}/run")
def run_search(sid: str):
    if not db.get_search(sid):
        raise HTTPException(404, "Search not found")
    return {"started": pipeline.start(sid)}


@app.delete("/api/searches/{sid}")
def delete_search(sid: str):
    if sid in pipeline.running():
        raise HTTPException(409, "Search is running")
    db.delete_search(sid)
    return {"deleted": True}


@app.get("/api/sources")
def get_sources():
    return {"health": db.health(), "testing": health.is_running()}


class TestIn(BaseModel):
    only: list[str] | None = None


@app.post("/api/sources/test")
def test_sources(body: TestIn | None = None):
    return {"started": health.start(body.only if body else None)}


# ---------------------------------------------------------------- API keys (values never leave this machine)

@app.get("/api/keys")
def get_keys():
    return {"keys": keys.status(), "search_engine": websearch.engine_name(), "agent": llm.available()}


class KeyIn(BaseModel):
    name: str
    value: str = ""


@app.put("/api/keys")
def put_key(body: KeyIn):
    try:
        keys.save(body.name, body.value)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    affected = next((k["unlocks"] for k in keys.KEYS if k["name"] == body.name), [])
    if body.value:
        health.start(affected)
    return {"saved": True, "testing": affected if body.value else []}


# ---------------------------------------------------------------- AI agent

class PlanIn(BaseModel):
    request: str = Field(min_length=4, max_length=600)


def _agent_error(e: Exception):
    if isinstance(e, NeedsKey):
        raise HTTPException(400, str(e)) from e
    if isinstance(e, Blocked):
        raise HTTPException(429, str(e)) from e
    raise HTTPException(500, f"Agent failed: {e}") from e


@app.post("/api/agent/plan")
def agent_plan(body: PlanIn):
    try:
        return agent.plan(body.request)
    except Exception as e:  # noqa: BLE001
        _agent_error(e)


@app.post("/api/leads/{lead_id}/research")
def research_lead(lead_id: str):
    try:
        return {"started": agent.start(lead_id)}
    except KeyError as e:
        raise HTTPException(404, "Lead not found") from e
    except Exception as e:  # noqa: BLE001
        _agent_error(e)


@app.get("/api/leads/{lead_id}/research")
def research_status(lead_id: str):
    return agent.status(lead_id) or {"state": "idle", "steps": []}


class ChatMessage(BaseModel):
    role: str
    content: str = Field(max_length=4000)


class ChatIn(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)
    statuses: dict[str, str] = {}


@app.post("/api/agent/chat")
def agent_chat(body: ChatIn):
    try:
        return {"job_id": chat.start([m.model_dump() for m in body.messages], body.statuses)}
    except Exception as e:  # noqa: BLE001
        _agent_error(e)


@app.get("/api/agent/chat/{job_id}")
def agent_chat_status(job_id: str):
    job = chat.status(job_id)
    if not job:
        raise HTTPException(404, "Conversation turn not found (the engine may have restarted)")
    return job
