"""OIDC (OpenID Connect) authentication.

Additive to password login. Implements the Authorization Code flow with PKCE:
  1. build_authorize_url() -> redirect the browser to the provider
  2. provider authenticates the user, redirects back with ?code&state
  3. exchange_code() -> swap the code for tokens
  4. validate_id_token() -> verify signature (provider JWKS), issuer, audience,
     expiry, and extract the verified email

Provider-agnostic: everything is read from the provider's discovery document
(<issuer>/.well-known/openid-configuration), so Google, Okta, Auth0, and Entra
all work with only config changes.

Security notes:
  - state defeats CSRF on the callback.
  - PKCE (code_verifier/code_challenge) protects the code exchange.
  - The ID token signature is verified against the provider's published JWKS;
    we never trust an unsigned or self-asserted email.
"""
import base64
import hashlib
import secrets
import time

import httpx
import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWTError

from app.config import settings

# Small in-process cache for the discovery doc + JWKS (they rarely change).
_disco_cache: dict = {}
_CACHE_TTL = 3600  # seconds


def _now() -> int:
    return int(time.time())


async def _discovery() -> dict:
    """Fetch and cache the provider's OpenID configuration."""
    hit = _disco_cache.get("doc")
    if hit and hit["exp"] > _now():
        return hit["doc"]
    url = settings.oidc_issuer.rstrip("/") + "/.well-known/openid-configuration"
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(url)
        r.raise_for_status()
        doc = r.json()
    _disco_cache["doc"] = {"doc": doc, "exp": _now() + _CACHE_TTL}
    return doc


def make_pkce() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for PKCE (S256)."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(40)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


def make_state() -> str:
    return secrets.token_urlsafe(24)


async def build_authorize_url(state: str, code_challenge: str) -> str:
    doc = await _discovery()
    from urllib.parse import urlencode
    params = {
        "response_type": "code",
        "client_id": settings.oidc_client_id,
        "redirect_uri": settings.oidc_redirect_uri,
        "scope": "openid email profile",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return doc["authorization_endpoint"] + "?" + urlencode(params)


async def exchange_code(code: str, code_verifier: str) -> dict:
    """Swap the authorization code for tokens (includes the id_token)."""
    doc = await _discovery()
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.oidc_redirect_uri,
        "client_id": settings.oidc_client_id,
        "client_secret": settings.oidc_client_secret,
        "code_verifier": code_verifier,
    }
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(doc["token_endpoint"], data=data)
        r.raise_for_status()
        return r.json()


async def validate_id_token(id_token: str) -> dict:
    """Verify the ID token against the provider JWKS and return its claims.
    Raises PyJWTError on any failure (bad signature, issuer, audience, expiry)."""
    doc = await _discovery()
    # PyJWKClient fetches the provider's signing keys and selects the one whose
    # kid matches the token header, then verifies the RS256 signature.
    jwks_client = PyJWKClient(doc["jwks_uri"])
    signing_key = jwks_client.get_signing_key_from_jwt(id_token)
    claims = jwt.decode(
        id_token,
        signing_key.key,
        algorithms=["RS256"],
        audience=settings.oidc_client_id,
        issuer=doc["issuer"],
    )
    return claims


def email_domain_allowed(email: str) -> bool:
    allowed = settings.oidc_allowed_domain_list
    if not allowed:
        return False  # fail closed: no domains configured => nobody may SSO in
    domain = email.rsplit("@", 1)[-1].lower()
    return domain in allowed
