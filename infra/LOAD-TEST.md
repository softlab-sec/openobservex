# OpenObserveX Load Test

Single-node capacity test. Measures where the ingest pipeline and queries
degrade under increasing telemetry volume, and which component gives first.

## Environment

- Single VM: 6 vCPU, 7.2 GiB RAM, 4 GiB swap
- All services co-located (Postgres, ClickHouse, OTel Collector, ingest
  gateway, Redis, Ollama, backend, frontend) via docker-compose
- Instrument: `GET /api/v1/system/health` (ingest lag, query latency,
  row rates) plus `docker stats` and `uptime`

## Method

Load was applied by running additional copies of the demo workload
generator as one-off containers with shortened emit intervals:

After each step, wait ~90s for the 5-minute rate window to reflect the new
load, then capture health, per-container CPU/mem, and load average.

## Results

| Load        | traces/min | ingest lag | CH query | load avg (6 cpu) | RAM free | status  |
|-------------|-----------:|-----------:|---------:|-----------------:|---------:|---------|
| baseline    |        208 |       3.0s |   2.6 ms |             ~0.8 |   436 Mi | healthy |
| ~5x         |       1059 |       4.0s |   2.4 ms |                — |   388 Mi | healthy |
| ~13x        |       2778 |       2.0s |   2.4 ms |                — |   330 Mi | healthy |
| ~36x        |       7582 |       5.0s |   3.2 ms |             2.04 |   352 Mi | healthy |
| ~84x        |      17449 |       1.0s |   3.0 ms |             2.22 |   197 Mi | healthy |

At the highest sustained rate (~84x the demo baseline, ~17.4k traces/min on
top of a steady ~6.2k metrics/min), ingest lag was 1s, ClickHouse queries
stayed at 3ms, and CPU load average was 2.22 on 6 cores (~37%). After
teardown, lag briefly rose to ~10s as ClickHouse drained the buffered
backlog, then returned to baseline. No data was dropped.

## Findings

1. **The ingest pipeline was never the bottleneck.** It absorbed ~84x the
   demo load with lag under 5s and CPU under 40%. The test was limited by
   how much load the *same VM* could generate (24 generator containers plus
   the full stack approached the RAM ceiling), not by the platform. Finding
   the true ingest ceiling requires an external load generator.

2. **Busiest components under load: ClickHouse (49% CPU at peak) and
   Postgres (33%).** ClickHouse CPU actually fell at moderate load (it
   batches writes efficiently) and only climbed near the top.

3. **Postgres load is proportional to alert/anomaly evaluation, not
   telemetry volume.** Postgres sat at ~25-33% CPU across every load level,
   because the evaluator and detector loops query it every cycle regardless
   of how much telemetry is flowing. This is the component to watch as the
   number of alert rules and anomaly detectors grows, not the ingest path.

4. **Query latency is decoupled from ingest load.** ClickHouse read latency
   stayed ~2.4-3.2ms whether ingesting 200 or 17,000 traces/min. Dashboards
   and alert evaluation stay responsive under heavy write load.

## Limits and honest caveats

- Ceiling not reached: the platform out-ran the load generator. A real
  ceiling number needs load driven from a separate machine.
- Memory is the box-level constraint at extreme generator counts, not a
  platform ingest limit.
- Single-run test, not sustained soak; long-duration behaviour (compaction,
  disk growth, memory creep over hours) is untested.

## Re-running

Ramp: `docker compose run -d --rm -e MIN_INTERVAL=0.1 -e MAX_INTERVAL=0.4 --name oox-load-<n> workload`
Measure: `curl -s localhost:8000/api/v1/system/health -H "Authorization: Bearer <token>"`
Tear down: `docker rm -f $(docker ps -q --filter "name=oox-load-")`
