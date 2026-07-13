from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from miles_desktop.core.work_queue import WorkQueue
from miles_desktop.models.entities import Department, WorkItem, WorkStatus
from miles_desktop.services.bootstrap import initialize
from miles_desktop.services.segment_inventory import SegmentInventoryService
from miles_desktop.storage.json_store import JsonStore

DATA_ROOT = Path(os.getenv("MILES_DATA_ROOT", "./.miles_data"))
store = JsonStore(DATA_ROOT)
queue = WorkQueue(store)
segments = SegmentInventoryService(store)
app = FastAPI(title="MILES Desktop API", version="0.0.7")


class WorkItemCreate(BaseModel):
    title: str
    department: Department
    objective: str
    source: str = "manual"
    priority: int = Field(default=50, ge=0, le=100)
    due_at: Optional[str] = None
    assigned_twin: Optional[str] = None
    system: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


class SegmentScanRequest(BaseModel):
    folder: str


@app.get("/health")
def health() -> dict:
    return {"ok": True, "data_root": str(DATA_ROOT)}


@app.post("/bootstrap")
def bootstrap() -> dict:
    return initialize(store)


@app.get("/systems")
def list_systems() -> list[dict]:
    return store.list("systems")


@app.post("/work")
def create_work(payload: WorkItemCreate) -> dict:
    item = WorkItem(**payload.model_dump())
    return queue.add(item).to_dict()


@app.get("/work")
def list_work(status: Optional[WorkStatus] = None) -> list[dict]:
    return [item.to_dict() for item in queue.list(status)]


@app.post("/work/{item_id}/approve")
def approve_work(item_id: str) -> dict:
    try:
        return queue.approve(item_id).to_dict()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/work/{item_id}/complete")
def complete_work(item_id: str, message: str = "Completed") -> dict:
    try:
        return queue.complete(item_id, message).to_dict()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/segments/scan")
def scan_segments(payload: SegmentScanRequest) -> dict:
    records = segments.scan_folder(payload.folder)
    return {"count": len(records), "segments": [record.to_dict() for record in records]}


@app.get("/segments")
def list_segments() -> list[dict]:
    return [record.to_dict() for record in segments.list()]
