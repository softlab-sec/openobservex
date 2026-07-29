"""Builds one set of OpenTelemetry providers per simulated service.

Each simulated service gets its own resource (service.name), so telemetry
lands in ClickHouse as if it came from separate microservices, while trace
context still flows across them to form one distributed trace.
"""

import logging
import os

from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

OTLP_ENDPOINT = os.getenv("OTLP_ENDPOINT", "http://otel-collector:4317")


class ServiceTelemetry:
    """Tracer, logger, and metric instruments for one simulated service."""

    def __init__(self, name, tracer, logger, latency_hist, request_counter):
        self.name = name
        self.tracer = tracer
        self.logger = logger
        self.latency = latency_hist
        self.requests = request_counter


def build_service(name: str) -> ServiceTelemetry:
    resource = Resource.create({"service.name": name, "deployment.environment": "demo"})

    # --- traces ---
    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=OTLP_ENDPOINT, insecure=True))
    )
    tracer = tracer_provider.get_tracer(name)

    # --- logs ---
    logger_provider = LoggerProvider(resource=resource)
    logger_provider.add_log_record_processor(
        BatchLogRecordProcessor(OTLPLogExporter(endpoint=OTLP_ENDPOINT, insecure=True))
    )
    handler = LoggingHandler(level=logging.INFO, logger_provider=logger_provider)
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    logger.addHandler(handler)
    logger.propagate = False

    # --- metrics ---
    reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=OTLP_ENDPOINT, insecure=True),
        export_interval_millis=10000,
    )
    meter_provider = MeterProvider(resource=resource, metric_readers=[reader])
    meter = meter_provider.get_meter(name)
    latency = meter.create_histogram(
        "http.server.duration", unit="ms", description="Request duration"
    )
    counter = meter.create_counter(
        "http.server.requests", description="Total requests handled"
    )

    return ServiceTelemetry(name, tracer, logger, latency, counter)
