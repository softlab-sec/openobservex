import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.postgres import Base


class NotificationChannel(Base):
    """A reusable notification destination an org configures once and rules reference.

    kind: email | slack | discord | webhook
    config holds kind-specific fields as JSON text:
      email   -> {smtp_host, smtp_port, username, password, from_addr, to_addrs, use_tls}
      slack   -> {webhook_url}
      discord -> {webhook_url}
      webhook -> {url}
    Secrets (SMTP password) live here; the API never returns them back to clients.
    """

    __tablename__ = "notification_channels"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(32), index=True)
    config: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
