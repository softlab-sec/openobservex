"""Continuous demo workload generator for OpenObserveX.

Simulates a small e-commerce system so the platform always has live
traces, logs, and metrics to display.
"""

import os
import random
import signal
import sys
import time

from otel_setup import build_service
from scenarios import pick_scenario

SERVICE_NAMES = [
    "api-gateway",
    "checkout-service",
    "payment-service",
    "inventory-service",
    "catalog-service",
    "user-service",
    "postgres-db",
]

ERROR_RATE = float(os.getenv("ERROR_RATE", "0.08"))
MIN_INTERVAL = float(os.getenv("MIN_INTERVAL", "0.4"))
MAX_INTERVAL = float(os.getenv("MAX_INTERVAL", "1.6"))

_running = True


def _stop(signum, frame):
    global _running
    _running = False
    print("shutting down workload generator", flush=True)


def main() -> int:
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    print("building telemetry providers...", flush=True)
    services = {name: build_service(name) for name in SERVICE_NAMES}
    print(f"generating workload across {len(services)} services", flush=True)

    count = 0
    while _running:
        scenario = pick_scenario()
        fail = random.random() < ERROR_RATE
        try:
            scenario(services, fail)
        except Exception as exc:  # noqa: BLE001
            print(f"scenario error: {exc}", flush=True)
        count += 1
        if count % 25 == 0:
            print(f"{count} requests simulated", flush=True)
        time.sleep(random.uniform(MIN_INTERVAL, MAX_INTERVAL))

    return 0


if __name__ == "__main__":
    sys.exit(main())
