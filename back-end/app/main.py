import logging
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from app.routes import auth, cv, projects
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Constella API")

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(cv.router)
app.include_router(projects.router)


def _code_from_status(status_code: int) -> str:
    return {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        422: "VALIDATION_ERROR",
    }.get(status_code, "SERVER_ERROR")


def _friendly_message(code: str, status_code: int) -> str:
    messages = {
        "BAD_REQUEST": "Invalid request.",
        "UNAUTHORIZED": "Please sign in again.",
        "FORBIDDEN": "You do not have access to this resource.",
        "NOT_FOUND": "Not found.",
        "VALIDATION_ERROR": "Some fields are invalid. Please review and try again.",
        "SERVER_ERROR": "Server error. Please try again.",
    }
    return messages.get(code) or ("Invalid request." if status_code < 500 else "Server error. Please try again.")


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    debug_id = uuid4().hex
    detail = exc.detail
    if isinstance(detail, dict) and detail.get("code"):
        code = detail.get("code")
        message = _friendly_message(code, exc.status_code)
    else:
        code = _code_from_status(exc.status_code)
        if isinstance(detail, str) and detail.strip() and exc.status_code < 500:
            message = detail
        else:
            message = _friendly_message(code, exc.status_code)

    if exc.status_code >= 500:
        logger = logging.getLogger("uvicorn.error")
        cause = exc.__cause__ or exc.__context__
        if cause:
            logger.error(
                "HTTPException debugId=%s code=%s path=%s",
                debug_id,
                code,
                request.url.path,
                exc_info=cause,
            )
        else:
            logger.exception(
                "HTTPException debugId=%s code=%s path=%s",
                debug_id,
                code,
                request.url.path,
            )

    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code, "message": message, "debugId": debug_id}},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    debug_id = uuid4().hex
    logging.getLogger("uvicorn.error").warning(
        "Validation error debugId=%s path=%s errors=%s",
        debug_id,
        request.url.path,
        exc.errors(),
    )
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Some fields are invalid. Please review and try again.",
                "debugId": debug_id,
            }
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    debug_id = uuid4().hex
    logging.getLogger("uvicorn.error").exception(
        "Unhandled error debugId=%s path=%s",
        debug_id,
        request.url.path,
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "SERVER_ERROR",
                "message": "Server error. Please try again.",
                "debugId": debug_id,
            }
        },
    )

@app.get("/")
def root():
    return {"message": "Backend running 🚀"}
