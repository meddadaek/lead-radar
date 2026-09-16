"""HTTP API for the Lead Radar web app (http://127.0.0.1:8030)."""
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import db, health, pipeline
from .known import archive


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


@app.post("/api/sources/test")
def test_sources():
    return {"started": health.start()}
