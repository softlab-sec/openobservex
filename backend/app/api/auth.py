import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status, Request
from app.core.audit import record_audit
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.db.postgres import get_db
from app.models import Organization, User

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


class RegisterRequest(BaseModel):
    # person
    full_name: str = Field(min_length=2, max_length=255)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    job_title: str | None = Field(default=None, max_length=128)
    department: str | None = Field(default=None, max_length=128)
    phone: str | None = Field(default=None, max_length=32)
    # company
    organization_name: str = Field(min_length=2, max_length=255)
    industry: str | None = Field(default=None, max_length=128)
    company_size: str | None = Field(default=None, max_length=32)
    country: str | None = Field(default=None, max_length=96)

    @field_validator("password")
    @classmethod
    def _password_policy(cls, v: str) -> str:
        import re
        checks = [
            (r"[A-Z]", "an uppercase letter"),
            (r"[a-z]", "a lowercase letter"),
            (r"[0-9]", "a number"),
            (r"[^A-Za-z0-9]", "a special character"),
        ]
        missing = [label for pattern, label in checks if not re.search(pattern, v)]
        if missing:
            raise ValueError("Password must contain " + ", ".join(missing) + ".")
        return v


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str | None
    job_title: str | None = None
    role: str
    organization_id: uuid.UUID

    model_config = {"from_attributes": True}


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "org"


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(status_code=400, detail="Email already registered")

    slug = _slugify(body.organization_name)
    org = db.scalar(select(Organization).where(Organization.slug == slug))
    if org is None:
        org = Organization(
            name=body.organization_name,
            slug=slug,
            industry=body.industry,
            company_size=body.company_size,
            country=body.country,
        )
        db.add(org)
        db.flush()  # assigns org.id without committing yet

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        job_title=body.job_title,
        department=body.department,
        phone=body.phone,
        role="admin",  # first user of an org is its admin
        organization_id=org.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    record_audit(
        db, action="user.create", resource_type="user",
        actor=user, resource_id=user.id, resource_name=user.email,
        after={"email": user.email, "role": user.role, "full_name": user.full_name},
        request=request,
    )
    return user


@router.post("/login", response_model=TokenResponse)
def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
):
    user = db.scalar(select(User).where(User.email == form.username))
    if not user or not verify_password(form.password, user.hashed_password):
        # Failed login: no authenticated user, so record with the attempted
        # email explicitly. Org id is unknown here (may be a bogus address).
        record_audit(
            db, action="user.login_failed", resource_type="user",
            actor_email=form.username, actor_role="unknown",
            organization_id=(user.organization_id if user else None),
            resource_name=form.username, request=request,
            detail="invalid email or password",
        )
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = create_access_token(
        subject=str(user.id),
        extra={"org": str(user.organization_id), "role": user.role},
    )
    record_audit(
        db, action="user.login", resource_type="user",
        actor=user, resource_name=user.email, request=request,
    )
    return TokenResponse(access_token=token)



def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    cred_exc = HTTPException(
        status_code=401,
        detail="Invalid authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        subject = payload.get("sub")
        if subject is None:
            raise cred_exc
        user = db.get(User, uuid.UUID(subject))
    except HTTPException:
        raise
    except Exception:
        raise cred_exc
    if user is None or not user.is_active:
        raise cred_exc
    return user


@router.get("/me", response_model=UserResponse)
def me(current: User = Depends(get_current_user)):
    return current

@router.post("/logout", status_code=204)
def logout(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stateless logout: the client discards its token. Recorded for the audit
    trail so sign-outs are visible alongside sign-ins."""
    record_audit(
        db, action="user.logout", resource_type="user",
        actor=user, resource_name=user.email, request=request,
    )
    return None
