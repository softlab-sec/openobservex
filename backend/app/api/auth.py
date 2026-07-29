import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field
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
    password: str = Field(min_length=8, max_length=128)
    job_title: str | None = Field(default=None, max_length=128)
    phone: str | None = Field(default=None, max_length=32)
    # company
    organization_name: str = Field(min_length=2, max_length=255)
    industry: str | None = Field(default=None, max_length=128)
    company_size: str | None = Field(default=None, max_length=32)
    country: str | None = Field(default=None, max_length=96)


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
def register(body: RegisterRequest, db: Session = Depends(get_db)):
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
        phone=body.phone,
        role="admin",  # first user of an org is its admin
        organization_id=org.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
def login(
    form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
):
    user = db.scalar(select(User).where(User.email == form.username))
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = create_access_token(
        subject=str(user.id),
        extra={"org": str(user.organization_id), "role": user.role},
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
