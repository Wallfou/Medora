"""Medora FastAPI server."""

import os
import tempfile
from typing import List

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import service

app = FastAPI(title="Medora API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExtractedItem(BaseModel):
    drug_name: str
    dosage: str = ""
    normalized: str


class ExtractResponse(BaseModel):
    items: List[ExtractedItem]


class AnalyzeRequest(BaseModel):
    drugs: List[str] = Field(..., min_length=1)


class AnalyzeResponse(BaseModel):
    medications: List[str]
    interactions: list
    beers_flags: list
    explanation: str
    major_count: int
    moderate_count: int


@app.get("/api/health")
def health():
    return {"status": "ok", "db": service.DB_FILE, "model": service.MODEL}


@app.post("/api/extract", response_model=ExtractResponse)
async def extract_from_image(file: UploadFile = File(...)):
    """Vision: extract drug names from a medication photo."""
    ct = (file.content_type or "").lower()
    if not ct.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail="Upload an image file (JPEG, PNG, WebP, etc.).",
        )

    suffix = os.path.splitext(file.filename or "")[1] or ".jpg"
    body = await file.read()
    if not body:
        raise HTTPException(status_code=400, detail="Empty file.")

    path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(body)
            path = tmp.name
        try:
            extracted = service.extract_drugs_from_image(path)
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Vision model error (is Ollama running with "
                    f"{service.MODEL}?): {e}"
                ),
            ) from e
    finally:
        if path and os.path.isfile(path):
            try:
                os.unlink(path)
            except OSError:
                pass

    items = []
    for item in extracted:
        raw = item.get("drug_name", "") or ""
        dosage = item.get("dosage", "") or ""
        normalized = service.normalize_drug_name(raw) if raw else ""
        items.append(
            ExtractedItem(
                drug_name=raw,
                dosage=str(dosage),
                normalized=normalized or raw.lower().strip(),
            )
        )

    if not items:
        raise HTTPException(
            status_code=422,
            detail="No medications could be extracted from the image.",
        )

    return ExtractResponse(items=items)


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(body: AnalyzeRequest):
    """Run interaction and Beers checks and Gemma explanation on confirmed names"""
    raw = [d.strip() for d in body.drugs if d and d.strip()]
    if not raw:
        raise HTTPException(status_code=400, detail="At least one drug name required.")

    names = list(dict.fromkeys(service.normalize_drug_name(d) for d in raw))

    interactions = service.find_interactions(names)
    beers_flags = service.find_beers_flags(names)

    try:
        explanation = service.generate_explanation(
            names, interactions, beers_flags
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"LLM error (is Ollama running with {service.MODEL}?): {e}",
        ) from e

    major = sum(1 for i in interactions if i.get("severity") == "major")
    moderate = sum(1 for i in interactions if i.get("severity") == "moderate")

    return AnalyzeResponse(
        medications=names,
        interactions=interactions,
        beers_flags=beers_flags,
        explanation=explanation,
        major_count=major,
        moderate_count=moderate,
    )
