"""Notification channels API: CRUD + test-send.

Secrets (SMTP password) are write-only: accepted on create/update, never
returned. The list/get responses expose a redacted config so the UI can show
which fields are set without leaking passwords.
"""

import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.db.postgres import get_db
from app.models import NotificationChannel, User
from app.services.dispatch import dispatch, parse_config
from app.core.roles import require_role

router = APIRouter(prefix="/api/v1/channels", tags=["channels"])

_SECRET_FIELDS = {"password"}


def _redact(config: dict) -> dict:
    return {k: ("••••••" if k in _SECRET_FIELDS and v else v) for k, v in config.items()}


class ChannelIn(BaseModel):
    name: str
    kind: str
    config: dict
    enabled: bool = True


class ChannelOut(BaseModel):
    id: uuid.UUID
    name: str
    kind: str
    config: dict
    enabled: bool
    created_at: datetime


def _to_out(ch: NotificationChannel) -> ChannelOut:
    return ChannelOut(
        id=ch.id, name=ch.name, kind=ch.kind,
        config=_redact(parse_config(ch.config)),
        enabled=ch.enabled, created_at=ch.created_at,
    )


@router.get("", response_model=list[ChannelOut])
def list_channels(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(NotificationChannel)
        .where(NotificationChannel.organization_id == user.organization_id)
        .order_by(NotificationChannel.created_at)
    ).all()
    return [_to_out(c) for c in rows]


@router.post("", response_model=ChannelOut, status_code=201, dependencies=[Depends(require_role("admin"))])
def create_channel(body: ChannelIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.kind not in ("email", "slack", "discord", "webhook"):
        raise HTTPException(422, "invalid channel kind")
    ch = NotificationChannel(
        organization_id=user.organization_id,
        name=body.name, kind=body.kind,
        config=json.dumps(body.config), enabled=body.enabled,
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return _to_out(ch)


@router.patch("/{channel_id}", response_model=ChannelOut, dependencies=[Depends(require_role("admin"))])
def update_channel(channel_id: uuid.UUID, body: ChannelIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ch = db.get(NotificationChannel, channel_id)
    if not ch or ch.organization_id != user.organization_id:
        raise HTTPException(404, "channel not found")
    existing = parse_config(ch.config)
    incoming = dict(body.config)
    for f in _SECRET_FIELDS:
        if incoming.get(f) in (None, "", "••••••"):
            incoming[f] = existing.get(f, "")
    ch.name, ch.kind, ch.enabled = body.name, body.kind, body.enabled
    ch.config = json.dumps(incoming)
    db.commit()
    db.refresh(ch)
    return _to_out(ch)


@router.delete("/{channel_id}", status_code=204, dependencies=[Depends(require_role("admin"))])
def delete_channel(channel_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ch = db.get(NotificationChannel, channel_id)
    if not ch or ch.organization_id != user.organization_id:
        raise HTTPException(404, "channel not found")
    db.delete(ch)
    db.commit()


@router.post("/{channel_id}/test", dependencies=[Depends(require_role("admin"))])
def test_channel(channel_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ch = db.get(NotificationChannel, channel_id)
    if not ch or ch.organization_id != user.organization_id:
        raise HTTPException(404, "channel not found")
    ok, detail = dispatch(
        ch.kind, parse_config(ch.config),
        "OpenObserveX test alert",
        "This is a test notification from OpenObserveX. If you received this, the channel works.",
    )
    return {"ok": ok, "detail": detail}
