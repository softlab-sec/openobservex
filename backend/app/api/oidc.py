"""OIDC SSO endpoints (additive — password login stays enabled).

Flow:
  GET /api/v1/auth/oidc/login
      -> if SSO enabled, set signed state+PKCE cookies and redirect to provider
  GET /api/v1/auth/oidc/callback?code&state
      -> verify state, exchange code, validate ID token, enforce allowed domain,
         find-or-create the user (new users get 'viewer'), audit, issue our JWT,
         redirect to the frontend with the token

New users are provisioned only if their email domain is in
OIDC_ALLOWED_DOMAINS; everyone else is rejected. Auto-provisioned users get the
lowest-privilege role (viewer); an admin promotes them later.
"""
import uuid
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core import oidc as oidc_svc
from app.core.audit import record_audit
from app.core.security import create_access_token
from app.db.postgres import get_db
from app.models import Organization, User

router = APIRouter(prefix="/api/v1/auth/oidc", tags=["auth", "sso"])

_STATE_COOKIE = "oox_oidc_state"
_VERIFIER_COOKIE = "oox_oidc_verifier"
_COOKIE_MAX_AGE = 600  # 10 minutes to complete the round trip


def _require_enabled():
    if not settings.oidc_enabled:
        raise HTTPException(status_code=404, detail="SSO is not enabled")
    if not (settings.oidc_issuer and settings.oidc_client_id and settings.oidc_redirect_uri):
        raise HTTPException(status_code=500, detail="SSO is enabled but not fully configured")


@router.get("/login")
async def oidc_login():
    _require_enabled()
    state = oidc_svc.make_state()
    verifier, challenge = oidc_svc.make_pkce()
    url = await oidc_svc.build_authorize_url(state, challenge)
    resp = RedirectResponse(url, status_code=302)
    # Short-lived, httponly cookies carry state + PKCE verifier to the callback.
    common = dict(max_age=_COOKIE_MAX_AGE, httponly=True, samesite="lax", path="/api/v1/auth/oidc")
    resp.set_cookie(_STATE_COOKIE, state, **common)
    resp.set_cookie(_VERIFIER_COOKIE, verifier, **common)
    return resp


@router.get("/callback")
async def oidc_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    _require_enabled()

    def _fail(reason: str):
        # Redirect back to the login page with an error, clearing the temp cookies.
        r = RedirectResponse(f"{settings.frontend_base_url}/login?sso_error={reason}", status_code=302)
        r.delete_cookie(_STATE_COOKIE, path="/api/v1/auth/oidc")
        r.delete_cookie(_VERIFIER_COOKIE, path="/api/v1/auth/oidc")
        return r

    if error:
        return _fail("provider_error")
    if not code or not state:
        return _fail("missing_code")

    cookie_state = request.cookies.get(_STATE_COOKIE)
    verifier = request.cookies.get(_VERIFIER_COOKIE)
    if not cookie_state or state != cookie_state or not verifier:
        return _fail("bad_state")

    # Exchange code -> tokens, then validate the ID token.
    try:
        tokens = await oidc_svc.exchange_code(code, verifier)
        id_token = tokens.get("id_token")
        if not id_token:
            return _fail("no_id_token")
        claims = await oidc_svc.validate_id_token(id_token)
    except Exception:
        return _fail("token_validation_failed")

    email = (claims.get("email") or "").lower()
    email_verified = claims.get("email_verified", True)
    if not email or not email_verified:
        return _fail("email_unverified")

    if not oidc_svc.email_domain_allowed(email):
        # Record the rejected attempt (security-relevant), then bounce.
        record_audit(
            db, action="user.login_failed", resource_type="user",
            actor_email=email, actor_role="unknown",
            resource_name=email, request=request,
            detail=f"SSO domain not allowed ({settings.oidc_provider_name})",
        )
        return _fail("domain_not_allowed")

    # Find-or-create the user.
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        # New SSO user: map to the org for their domain, or the first org as a
        # fallback. Provision at the lowest privilege (viewer).
        domain = email.rsplit("@", 1)[-1]
        org = db.scalar(select(Organization).order_by(Organization.created_at).limit(1))
        if org is None:
            return _fail("no_organization")
        user = User(
            email=email,
            hashed_password=None,
            full_name=claims.get("name"),
            role="viewer",
            is_active=True,
            organization_id=org.id,
            auth_provider=settings.oidc_provider_name,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        record_audit(
            db, action="user.create", resource_type="user",
            actor=user, resource_id=user.id, resource_name=user.email,
            after={"email": user.email, "role": user.role, "auth_provider": user.auth_provider},
            detail=f"auto-provisioned via {settings.oidc_provider_name} SSO",
            request=request,
        )
    else:
        if not user.is_active:
            return _fail("account_disabled")

    # Issue our normal JWT — SSO users get an ordinary session.
    token = create_access_token(
        subject=str(user.id),
        extra={"org": str(user.organization_id), "role": user.role},
    )
    record_audit(
        db, action="user.login", resource_type="user",
        actor=user, resource_name=user.email, request=request,
        detail=f"SSO ({settings.oidc_provider_name})",
    )

    # Hand the token to the frontend, then clear the temp cookies.
    resp = RedirectResponse(f"{settings.frontend_base_url}/login?sso_token={token}", status_code=302)
    resp.delete_cookie(_STATE_COOKIE, path="/api/v1/auth/oidc")
    resp.delete_cookie(_VERIFIER_COOKIE, path="/api/v1/auth/oidc")
    return resp


@router.get("/status")
def oidc_status():
    """Public: tells the login page whether to show the SSO button."""
    return {
        "enabled": settings.oidc_enabled,
        "provider_name": settings.oidc_provider_name,
    }
