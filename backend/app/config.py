from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration read from environment variables (injected by Compose)."""

    model_config = SettingsConfigDict(extra="ignore")

    # ClickHouse (telemetry store)
    clickhouse_host: str = "clickhouse"
    clickhouse_port: int = 8123
    clickhouse_user: str = "oox"
    clickhouse_password: str = "change_me_dev_password"
    clickhouse_db: str = "openobservex"

    # PostgreSQL (application store)
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_user: str = "oox"
    postgres_password: str = "change_me_dev_password"
    postgres_db: str = "openobservex"

    # Local AI (Ollama). Inference stays on this host.
    ollama_url: str = "http://ollama:11434"
    ollama_model: str = "llama3.2:3b"
    ollama_timeout: int = 300

    # Auth / JWT
    jwt_secret: str = "dev-insecure-change-me-min-32-bytes-long-secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480  # 8h; refresh tokens come later

    # Background workers (alert evaluator + anomaly detector). When the dedicated
    # worker process runs (see app/worker.py + the "worker" compose service),
    # the API sets this false so the loops run in exactly ONE place. Set true to
    # run them inside the API (single-process dev, or if the worker is disabled).
    run_workers_in_api: bool = False

    # SSO / OIDC (additive — password login stays enabled)
    oidc_enabled: bool = False
    oidc_issuer: str = ""            # e.g. https://accounts.google.com
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_redirect_uri: str = ""      # e.g. http://192.168.253.10:8000/api/v1/auth/oidc/callback
    oidc_allowed_domains: str = ""   # comma-separated, e.g. "company.com,sub.company.com"
    oidc_provider_name: str = "sso"  # label shown on the button + in audit
    frontend_base_url: str = "http://192.168.253.10:3000"  # where to redirect after login

    @property
    def oidc_allowed_domain_list(self) -> list[str]:
        return [d.strip().lower() for d in self.oidc_allowed_domains.split(",") if d.strip()]

    @property
    def postgres_dsn(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


settings = Settings()
