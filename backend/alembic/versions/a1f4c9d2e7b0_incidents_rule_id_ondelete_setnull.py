"""incidents rule_id on delete set null

Revision ID: a1f4c9d2e7b0
Revises: 488b28ac7625
Create Date: 2026-08-19

Hand-written (not autogenerate) so it does not sweep in unrelated
api_keys drift. Recreates incidents_rule_id_fkey with ON DELETE SET NULL
so deleting an alert rule detaches its incidents (preserving history)
instead of raising a foreign-key violation.
"""
from alembic import op

revision = "a1f4c9d2e7b0"
down_revision = "488b28ac7625"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("incidents_rule_id_fkey", "incidents", type_="foreignkey")
    op.create_foreign_key(
        "incidents_rule_id_fkey", "incidents", "alert_rules",
        ["rule_id"], ["id"], ondelete="SET NULL",
    )


def downgrade():
    op.drop_constraint("incidents_rule_id_fkey", "incidents", type_="foreignkey")
    op.create_foreign_key(
        "incidents_rule_id_fkey", "incidents", "alert_rules",
        ["rule_id"], ["id"],
    )
