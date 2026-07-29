# OpenObserveX

A full-stack, open-source observability platform: metrics, logs, and traces in
one place, with alerting, dashboards, and AI-assisted analysis.

Built from scratch, phase by phase. Everything runs in Docker.

## Status

Phase 0 - project skeleton and storage layer.

## Stack

- **Storage:** ClickHouse (telemetry), PostgreSQL (users, config, alerts)
- **Ingestion:** OpenTelemetry Collector
- **Backend:** FastAPI (Python 3.12)
- **Frontend:** Next.js (TypeScript)
- **AI:** Ollama (local models, no external APIs)

## Requirements

- Docker + Docker Compose

## Running

Instructions land as each phase is built.

## Layout

- \`infra/\`     service configuration (databases, collector)
- \`backend/\`   FastAPI application (added later)
- \`frontend/\`  Next.js application (added later)
- \`docs/\`      architecture and operations documentation
