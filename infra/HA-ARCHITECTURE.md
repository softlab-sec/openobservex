# OpenObserveX High Availability Architecture

This document describes what high availability (HA) requires for OpenObserveX,
the concrete gap between the current single-node deployment and an HA one, and a
staged path to get there. It is a design and planning artifact, not a runbook:
true HA cannot be built on the current single-VM host, so this captures the
target so it can be executed when the infrastructure exists.

HA and disaster recovery are different goals. DR (see infra/DR-PLAN.md) is about
recovering after a failure. HA is about not going down in the first place, by
removing single points of failure so that one component's failure does not take
the platform offline. This document is about the second goal.

## 1. Current state: single node, single point of failure

Everything runs as containers on one host. If that host fails, the entire
platform is offline until the DR runbook completes. Every service, its data, and
its network live on the same machine. There is no redundancy at any layer.

This is an appropriate and honest starting point for the current stage. HA adds
real cost and operational complexity, and is only worth it once uptime
commitments justify it. This document exists so the move is deliberate when the
time comes.

## 2. Services classified: stateless vs stateful

The path to HA depends entirely on whether a service holds state.

Stateless services (easy to make HA: run multiple copies behind a load
balancer, any copy can serve any request):
- API (backend) - holds no in-process session state. Authentication is
  stateless JWT, so any API instance can validate any token. This is the single
  most important property for HA and it already holds.
- Frontend - static/SSR Next.js, trivially horizontally scalable.
- OTel collector and ingest gateway - stateless pipeline stages; scale by
  running more instances behind the ingest endpoint.
- Worker (evaluator/detector) - stateless in itself, BUT see Section 4: multiple
  workers would double-evaluate, so the worker needs coordination, not just
  replication.

Stateful services (the hard, expensive part of HA - they own data pinned to a
host via a volume):
- PostgreSQL (postgres_data) - the application database. The critical state.
- ClickHouse (clickhouse_data) - telemetry store.

Special cases:
- Redis - already in the stack (used by the ingest gateway). It is the natural
  substrate for the coordination HA needs: shared state, worker leader election,
  and distributed rate limiting. In an HA design it becomes shared
  infrastructure rather than a gateway-only dependency, and would itself need to
  be run in a replicated mode (Redis Sentinel or a managed Redis).
- Ollama (ollama_models) - the volume holds model weights, which are
  re-pullable, not true state. Not an HA blocker.

## 3. What HA requires, layer by layer

### 3.1 Load balancing and multiple app instances
Put a load balancer (or ingress) in front of the stateless services and run at
least two instances of each across at least two hosts. Because the API is
stateless, this is straightforward: add instances, health-check them, and let
the balancer route around a failed one. Health checks already exist on the
backend service and are the hook the balancer would use.

### 3.2 PostgreSQL replication (the core of the work)
This is where HA gets real. Options, from least to most operational burden:
- Managed Postgres (RDS, Cloud SQL, or equivalent) with a standby replica and
  automatic failover. Strongly recommended: it moves the hardest problem
  (correct, tested failover) to a provider. Lowest engineering cost for a real
  guarantee.
- Self-managed primary/replica with streaming replication plus an automatic
  failover controller (Patroni, repmgr). Full control, significant operational
  responsibility - you own failover correctness, split-brain prevention, and
  replica lag monitoring.
Either way, the application connects to a single endpoint (the primary, or a
proxy that always points at the current primary), so application changes are
minimal - mostly connection string and retry/backoff on failover.

### 3.3 ClickHouse replication
ClickHouse HA uses ReplicatedMergeTree table engines coordinated by ClickHouse
Keeper (or ZooKeeper), typically across a cluster of nodes. This is a schema and
topology change (replicated engines, a cluster definition) more than an
application change. Because telemetry is less critical than the application
database (it is re-ingestable and short-TTL), ClickHouse HA can reasonably be a
later phase than Postgres HA.

### 3.4 Redis
If Redis becomes shared coordination infrastructure (Section 4), it must not be
a new single point of failure. Run it replicated (Redis Sentinel) or use a
managed Redis with failover.

### 3.5 Networking and placement
HA only helps if the redundant copies do not share a failure domain. Instances
must span at least two physical hosts, ideally two availability zones, so a
single host or rack failure cannot take down all copies of a service.

## 4. The multi-worker coordination problem

The evaluator/detector worker is stateless code, but its work is not safe to run
concurrently: two workers would each evaluate every alert rule and run every
anomaly check, producing duplicate incidents and duplicate notifications. So the
worker cannot simply be scaled to multiple copies the way the API can.

Two correct patterns, both leaning on the Redis that is already in the stack:
- Leader election: multiple worker instances run for availability, but only the
  elected leader executes the loops. If the leader dies, another takes over.
  This gives failover without duplication, but no throughput gain (still one
  active worker at a time).
- Work partitioning: rules/detectors are sharded across workers (for example by
  a hash of rule id), so each rule is owned by exactly one worker and the load
  is shared. More complex; needed only when a single worker cannot keep up.

For a first HA milestone, leader election is the right choice: it delivers the
availability goal (worker failover) without the complexity of partitioning. This
is the natural extension of the fault-isolation split already completed - the
single dedicated worker becomes a small pool with one active leader.

## 5. Staged path (recommended order)

Each stage is independently valuable and can be adopted as the infrastructure
and uptime requirements justify the cost.

Stage 0 (done): fault isolation on one node - the evaluator/detector run in a
dedicated worker process, isolated from the API. Not HA, but the structural
groundwork.

Stage 1 - off-host backups. Before HA, close the DR gap: copy backups off the
host (see infra/DR-PLAN.md, Section 6). Cheap, high value, and a prerequisite
for trusting any multi-host setup.

Stage 2 - stateless redundancy. Add a load balancer and run 2+ API, frontend,
collector, and gateway instances across 2 hosts. Immediately removes the app
tier as a single point of failure. Low complexity because the app is already
stateless.

Stage 3 - Postgres HA. Move to managed Postgres with a standby, or self-managed
primary/replica with automatic failover. This is the largest single step and the
one that most defines real HA.

Stage 4 - worker leader election. Run a worker pool with Redis-based leader
election so evaluation survives a worker or host failure without duplication.

Stage 5 - ClickHouse HA and Redis HA. Replicated ClickHouse across a cluster,
replicated Redis. Completes the picture; sequenced last because telemetry is the
most recoverable data.

## 6. Honest cost and trade-offs

- HA multiplies infrastructure cost: at least double the hosts, plus load
  balancing and replicated data stores. It is justified by an uptime commitment,
  not adopted by default.
- HA increases operational complexity: failover has to be tested, replica lag
  and split-brain have to be monitored, and the system has more moving parts to
  reason about. Untested failover is not HA; it is a false sense of security.
- The current single-node design is the correct choice until there is a concrete
  availability requirement (an SLA, paying customers with uptime expectations).
  This document ensures the move to HA is a planned architecture change rather
  than an emergency retrofit.

## 7. Summary

The application tier is already HA-ready: it is stateless, JWT-authenticated, and
health-checked. The real work is the stateful layer - Postgres first, then
ClickHouse and Redis - plus load balancing for the app tier and leader election
for the worker. The recommended path is off-host backups, then stateless
redundancy, then Postgres HA, then worker leader election, then the remaining
data stores. None of it can be built on the current single VM; all of it is
captured here to be executed when the hosts and the uptime requirement exist.
