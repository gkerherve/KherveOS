"""Reference metadata lookups (Crossref, arXiv, OpenLibrary) for KherveRef. (Being built.)"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/refs", tags=["refs"])
