"""SSO support: hashed_password nullable, auth_provider column

Revision ID: d4a9c1e6f2b8
Revises: c3f8e2b5a9d1
Create Date: 2026-08-20

SSO users authenticate via an external identity provider and have no local
password, so hashed_password becomes nullable. auth_provider records how the
user signs in ("password" or an OIDC provider name) for clarity and audit.
"""
from alembic import op
import sqlalchemy as sa

revision = "d4a9c1e6f2b8"
down_revision = "c3f8e2b5a9d1"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("users", "hashed_password", nullable=True)
    op.add_column("users", sa.Column("auth_provider", sa.String(64), nullable=False, server_default="password"))


def downgrade():
    op.drop_column("users", "auth_provider")
    op.alter_column("users", "hashed_password", nullable=False)
