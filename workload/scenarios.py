"""Simulated user journeys that produce realistic distributed traces."""

import random
import time

from opentelemetry.trace import SpanKind, Status, StatusCode


def _work(low_ms: int, high_ms: int) -> float:
    """Simulate work and return elapsed milliseconds."""
    ms = random.uniform(low_ms, high_ms)
    time.sleep(ms / 1000.0)
    return ms


def _record(svc, route: str, status: int, elapsed_ms: float) -> None:
    attrs = {"http.route": route, "http.status_code": status, "service": svc.name}
    svc.latency.record(elapsed_ms, attrs)
    svc.requests.add(1, attrs)


def checkout_flow(services: dict, fail: bool) -> None:
    """gateway -> checkout -> inventory -> payment -> database"""
    gw, checkout = services["api-gateway"], services["checkout-service"]
    inventory, payment = services["inventory-service"], services["payment-service"]
    db = services["postgres-db"]

    order_id = f"ord-{random.randint(10000, 99999)}"

    with gw.tracer.start_as_current_span(
        "POST /api/checkout", kind=SpanKind.SERVER
    ) as root:
        root.set_attribute("http.method", "POST")
        root.set_attribute("http.route", "/api/checkout")
        root.set_attribute("order.id", order_id)
        started = _work(2, 8)
        gw.logger.info("checkout request received order_id=%s", order_id)

        with checkout.tracer.start_as_current_span("checkout.process") as cs:
            cs.set_attribute("order.id", order_id)
            _work(5, 15)

            with inventory.tracer.start_as_current_span("inventory.reserve") as inv:
                inv.set_attribute("order.id", order_id)
                _work(8, 30)
                with db.tracer.start_as_current_span(
                    "SELECT stock", kind=SpanKind.CLIENT
                ) as q:
                    q.set_attribute("db.system", "postgresql")
                    q.set_attribute("db.statement", "SELECT qty FROM stock WHERE sku=$1")
                    _work(3, 25)

            with payment.tracer.start_as_current_span("payment.charge") as pay:
                pay.set_attribute("order.id", order_id)
                pay.set_attribute("payment.provider", "stripe-sim")
                elapsed = _work(20, 90)
                if fail:
                    pay.set_status(Status(StatusCode.ERROR, "card declined"))
                    pay.record_exception(RuntimeError("PaymentDeclined: card declined"))
                    payment.logger.error(
                        "payment declined order_id=%s provider=stripe-sim", order_id
                    )
                    _record(payment, "/charge", 402, elapsed)
                else:
                    _record(payment, "/charge", 200, elapsed)

        total = started + random.uniform(40, 120)
        if fail:
            root.set_status(Status(StatusCode.ERROR, "checkout failed"))
            gw.logger.error("checkout failed order_id=%s status=402", order_id)
            _record(gw, "/api/checkout", 402, total)
        else:
            gw.logger.info("checkout completed order_id=%s status=200", order_id)
            _record(gw, "/api/checkout", 200, total)


def browse_flow(services: dict, fail: bool) -> None:
    """gateway -> catalog -> database"""
    gw = services["api-gateway"]
    catalog = services["catalog-service"]
    db = services["postgres-db"]
    category = random.choice(["shoes", "laptops", "books", "phones"])

    with gw.tracer.start_as_current_span(
        "GET /api/products", kind=SpanKind.SERVER
    ) as root:
        root.set_attribute("http.method", "GET")
        root.set_attribute("http.route", "/api/products")
        root.set_attribute("catalog.category", category)
        elapsed = _work(2, 6)

        with catalog.tracer.start_as_current_span("catalog.search") as cs:
            cs.set_attribute("catalog.category", category)
            _work(5, 20)
            with db.tracer.start_as_current_span(
                "SELECT products", kind=SpanKind.CLIENT
            ) as q:
                q.set_attribute("db.system", "postgresql")
                q.set_attribute("db.statement", "SELECT * FROM products WHERE category=$1")
                qms = _work(4, 60)
                if qms > 45:
                    catalog.logger.warning(
                        "slow catalog query category=%s duration_ms=%.1f", category, qms
                    )

        total = elapsed + random.uniform(15, 80)
        if fail:
            root.set_status(Status(StatusCode.ERROR, "upstream timeout"))
            gw.logger.error("catalog request failed category=%s status=503", category)
            _record(gw, "/api/products", 503, total)
        else:
            gw.logger.info("catalog request served category=%s status=200", category)
            _record(gw, "/api/products", 200, total)


def login_flow(services: dict, fail: bool) -> None:
    """gateway -> user-service -> database"""
    gw = services["api-gateway"]
    users = services["user-service"]
    db = services["postgres-db"]
    user_id = f"usr-{random.randint(1000, 9999)}"

    with gw.tracer.start_as_current_span("POST /api/login", kind=SpanKind.SERVER) as root:
        root.set_attribute("http.method", "POST")
        root.set_attribute("http.route", "/api/login")
        root.set_attribute("user.id", user_id)
        elapsed = _work(2, 5)

        with users.tracer.start_as_current_span("auth.verify_credentials") as auth:
            auth.set_attribute("user.id", user_id)
            _work(10, 40)
            with db.tracer.start_as_current_span("SELECT user", kind=SpanKind.CLIENT) as q:
                q.set_attribute("db.system", "postgresql")
                q.set_attribute("db.statement", "SELECT * FROM users WHERE email=$1")
                _work(3, 18)
            if fail:
                auth.set_status(Status(StatusCode.ERROR, "invalid credentials"))
                users.logger.warning(
                    "failed login attempt user_id=%s reason=bad_password", user_id
                )

        total = elapsed + random.uniform(20, 70)
        if fail:
            root.set_status(Status(StatusCode.ERROR, "unauthorized"))
            _record(gw, "/api/login", 401, total)
        else:
            gw.logger.info("login successful user_id=%s", user_id)
            _record(gw, "/api/login", 200, total)


SCENARIOS = [
    (checkout_flow, 0.35),
    (browse_flow, 0.45),
    (login_flow, 0.20),
]


def pick_scenario():
    r = random.random()
    cumulative = 0.0
    for fn, weight in SCENARIOS:
        cumulative += weight
        if r <= cumulative:
            return fn
    return SCENARIOS[-1][0]
