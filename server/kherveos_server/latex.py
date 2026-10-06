"""LaTeX compilation with tectonic, for KherveTeX, KherveSlide and KherveNote. (Being built.)"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/latex", tags=["latex"])
