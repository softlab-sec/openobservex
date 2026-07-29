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

    @property
    def postgres_dsn(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


settings = Settings()
