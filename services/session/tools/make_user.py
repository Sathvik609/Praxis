"""Print a PRAXIS_USERS entry (user:Display:salt:hash) for a new account.

    uv run python tools/make_user.py rinky Rinky 'example-password'
"""
from __future__ import annotations

import secrets
import sys

from praxis_session.auth import hash_password


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    user, name, password = argv
    salt = secrets.token_hex(16)
    print(f"{user.lower()}:{name}:{salt}:{hash_password(password, salt)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
