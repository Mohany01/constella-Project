"""Background scheduler for timeline and deadline alert checks."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from .alert_agent import run_deadline_alert_agent


LOGGER = logging.getLogger("uvicorn.error")
_scheduler_task: asyncio.Task | None = None
_stop_event: asyncio.Event | None = None


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except Exception:
        value = default
    return max(minimum, value)


async def _run_alert_check(due_soon_days: int) -> None:
    try:
        result = await asyncio.to_thread(
            run_deadline_alert_agent,
            project_id=None,
            due_soon_days=due_soon_days,
        )
        LOGGER.info(
            "Scheduled alert check completed: tasks=%s detected=%s inserted=%s resolved=%s activated=%s",
            result.get("task_count", 0),
            result.get("detected_count", 0),
            result.get("inserted_count", 0),
            result.get("resolved_count", 0),
            (result.get("timeline_status_updates") or {}).get("activated_count", 0),
        )
    except Exception:
        LOGGER.exception("Scheduled alert check failed")


async def _scheduler_loop(stop_event: asyncio.Event) -> None:
    interval_seconds = _env_int("TIMELINE_ALERT_INTERVAL_SECONDS", 300, 60)
    due_soon_days = _env_int("TIMELINE_ALERT_DUE_SOON_DAYS", 3, 1)
    run_on_start = _env_bool("TIMELINE_ALERT_RUN_ON_START", True)

    LOGGER.info(
        "Timeline alert scheduler started: interval=%ss due_soon_days=%s run_on_start=%s",
        interval_seconds,
        due_soon_days,
        run_on_start,
    )

    if run_on_start:
        await _run_alert_check(due_soon_days)

    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
        except asyncio.TimeoutError:
            await _run_alert_check(due_soon_days)

    LOGGER.info("Timeline alert scheduler stopped")


def start_alert_scheduler() -> dict[str, Any]:
    """Start one in-process scheduler task for the current API worker."""
    global _scheduler_task, _stop_event

    enabled = _env_bool("TIMELINE_ALERT_SCHEDULER_ENABLED", True)
    if not enabled:
        LOGGER.info("Timeline alert scheduler disabled by TIMELINE_ALERT_SCHEDULER_ENABLED")
        return {"enabled": False, "running": False}

    if _scheduler_task and not _scheduler_task.done():
        return {"enabled": True, "running": True}

    _stop_event = asyncio.Event()
    _scheduler_task = asyncio.create_task(
        _scheduler_loop(_stop_event),
        name="timeline-alert-scheduler",
    )
    return {"enabled": True, "running": True}


async def stop_alert_scheduler() -> None:
    """Stop the in-process scheduler task."""
    global _scheduler_task, _stop_event

    if not _scheduler_task:
        return

    if _stop_event:
        _stop_event.set()

    try:
        await asyncio.wait_for(_scheduler_task, timeout=5)
    except asyncio.TimeoutError:
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except asyncio.CancelledError:
            pass
    finally:
        _scheduler_task = None
        _stop_event = None
