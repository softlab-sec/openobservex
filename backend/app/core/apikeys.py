"""API key generation and verification.

Format: oox_<prefix8>_<secret32>  (e.g. oox_a1b2c3d4_Xy9...)
- prefix8: public, stored plaintext, used for O(1) lookup + UI display
- secret32: high-entropy secret, only its SHA-256 hash is stored
The full string is shown once and never recoverable.
"""

import hashlib
import secrets


KEY_PREFIX = "oox"


def generate_key() -> tuple[str, str, str]:
    """Return (full_key, public_prefix, key_hash).

    full_key is shown to the user once; public_prefix + key_hash are stored.
    """
    prefix_part = secrets.token_hex(4)          # 8 hex chars
    secret_part = secrets.token_urlsafe(32)     # ~43 chars, high entropy
    full_key = f"{KEY_PREFIX}_{prefix_part}_{secret_part}"
    public_prefix = f"{KEY_PREFIX}_{prefix_part}"
    key_hash = hashlib.sha256(full_key.encode()).hexdigest()
    return full_key, public_prefix, key_hash


def hash_key(full_key: str) -> str:
    return hashlib.sha256(full_key.encode()).hexdigest()


def extract_prefix(full_key: str) -> str | None:
    """Pull the public prefix from a presented key for fast lookup."""
    parts = full_key.split("_")
    if len(parts) >= 2 and parts[0] == KEY_PREFIX:
        return f"{parts[0]}_{parts[1]}"
    return None
