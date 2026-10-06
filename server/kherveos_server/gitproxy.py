"""A CORS proxy for Git over HTTPS (GitHub…), for the browser's isomorphic-git. (Being built.)"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/git", tags=["git"])
