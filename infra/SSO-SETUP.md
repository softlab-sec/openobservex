# SSO (OIDC) Setup

OpenObserveX supports OpenID Connect single sign-on, additive to password
login. Password login keeps working; the "Sign in with SSO" button appears
only when SSO is enabled. Works with any OIDC provider (Google Workspace,
Okta, Auth0, Microsoft Entra).

## How it works

1. User clicks "Sign in with <provider>" -> redirected to the provider.
2. Provider authenticates them, redirects back to the callback.
3. OpenObserveX verifies the ID token (signature via the provider's JWKS,
   issuer, audience, expiry), checks the email domain, finds or creates the
   user, and issues a normal session token.

Security model:
- Only emails in OIDC_ALLOWED_DOMAINS may sign in. Empty list = nobody
  (fails closed).
- New SSO users are provisioned at the lowest privilege (viewer). An admin
  promotes them afterward.
- Auto-provisioning maps the user to the first organization. (Multi-org
  domain mapping is a later enhancement.)
- Every SSO login, auto-provision, and rejected attempt is recorded in the
  audit log.

## 1. Register the app with your provider

Create an OAuth 2.0 / OIDC client and set the redirect URI to:

    http://<your-host>:8000/api/v1/auth/oidc/callback

(Use your real external host, e.g. http://192.168.253.10:8000/... , and
https in production.) The provider gives you a Client ID and Client Secret.

Provider issuer URLs (for OIDC_ISSUER):
- Google:    https://accounts.google.com
- Okta:      https://<your-domain>.okta.com
- Auth0:     https://<your-tenant>.us.auth0.com
- Entra:     https://login.microsoftonline.com/<tenant-id>/v2.0

## 2. Configure .env

    OIDC_ENABLED=true
    OIDC_ISSUER=https://accounts.google.com
    OIDC_CLIENT_ID=<from the provider>
    OIDC_CLIENT_SECRET=<from the provider>
    OIDC_REDIRECT_URI=http://192.168.253.10:8000/api/v1/auth/oidc/callback
    OIDC_ALLOWED_DOMAINS=yourcompany.com
    OIDC_PROVIDER_NAME=Google
    FRONTEND_BASE_URL=http://192.168.253.10:3000

Then restart the backend:

    docker compose restart backend

## 3. Verify

- GET /api/v1/auth/oidc/status should report {"enabled": true, ...}.
- The login page shows a "Sign in with <provider>" button.
- Sign in with an allowed-domain account; you land on the dashboard as a
  viewer, and the audit log shows user.login (SSO) plus user.create for a
  first-time user.

## Notes and future work

- Multi-org domain mapping (route domains to specific organizations).
- Group/role mapping from provider claims (e.g. map an IdP group to admin).
- SAML support for enterprises that require it.
