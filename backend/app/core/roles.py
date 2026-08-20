"""Role-based access control.

Three roles, ordered by privilege:
  admin  — full control: users, API keys, applications, alert rules,
           channels, maintenance windows.
  member — operational: create/edit/acknowledge/resolve alerts and
           incidents; cannot manage API keys, applications, or users.
  viewer — read-only: sees everything, changes nothing.

Roles are hierarchical: a higher role satisfies any lower-role requirement
(admin passes a member check; member passes a viewer check).

The `role` column already exists on User (default "admin"), so existing
users keep full access — enforcement is additive, it never silently
downgrades anyone.
"""
from fastapi import Depends, HTTPException

from app.models import User
from app.api.auth import get_current_user

# Higher number = more privilege.
_RANK = {"viewer": 0, "member": 1, "admin": 2}


def _rank(role: str | None) -> int:
    return _RANK.get((role or "").lower(), -1)


def require_role(minimum: str):
    """Dependency factory: require at least `minimum` role.

    Usage:
        @router.delete(..., dependencies=[Depends(require_role("admin"))])
        def delete_thing(...): ...

    Or to use the user in the body:
        user: User = Depends(require_role("member"))
    """
    needed = _rank(minimum)
    if needed < 0:
        raise ValueError(f"unknown role requirement: {minimum!r}")

    def _dep(user: User = Depends(get_current_user)) -> User:
        if _rank(user.role) < needed:
            raise HTTPException(
                status_code=403,
                detail=f"This action requires the '{minimum}' role or higher.",
            )
        return user

    return _dep


# Convenience dependencies.
require_admin = require_role("admin")
require_member = require_role("member")  # admin or member
