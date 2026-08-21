"""Dedicated background-worker process.

Runs the alert evaluator and anomaly detector loops in their OWN process,
separate from the API. This isolates their failure domain: a heavy evaluation
cycle no longer competes with API request handling on the same event loop, and
a crash in detection cannot take down the API.

Run via the "worker" service in docker-compose:
    python -m app.worker

The API process must NOT also run these loops (settings.run_workers_in_api must
be false) or alerts/anomalies would be evaluated twice. This is the single
place the loops live in production.
"""
import asyncio
import logging
import signal

import app.models  # noqa: F401  (register models on Base.metadata)
from app.services.evaluator import evaluator_loop
from app.services.detector import detector_loop
from app.services.slo import slo_loop

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("worker")


async def main() -> None:
    logger.info("OpenObserveX worker starting (evaluator + detector)")
    tasks = [
        asyncio.create_task(evaluator_loop(), name="evaluator"),
        asyncio.create_task(detector_loop(), name="detector"),
        asyncio.create_task(slo_loop(), name="slo"),
    ]

    stop = asyncio.Event()

    def _request_stop() -> None:
        logger.info("shutdown signal received, stopping worker")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except NotImplementedError:
            pass  # signal handlers unavailable on some platforms

    # If either loop dies unexpectedly, surface it and shut down so the
    # container restarts (restart: unless-stopped) rather than silently
    # running degraded with only one loop alive.
    async def _watch() -> None:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            if t.cancelled():
                continue
            exc = t.exception()
            logger.error("worker loop %s exited unexpectedly: %r", t.get_name(), exc)
        stop.set()

    watcher = asyncio.create_task(_watch())
    await stop.wait()

    for t in tasks:
        t.cancel()
    watcher.cancel()
    await asyncio.gather(*tasks, watcher, return_exceptions=True)
    logger.info("worker stopped")


if __name__ == "__main__":
    asyncio.run(main())
