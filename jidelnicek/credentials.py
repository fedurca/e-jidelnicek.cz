"""Přihlašovací údaje čte ze souboru nebo z prostředí. Do kódu nepatří."""

from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class CredentialsMissing(Exception):
    """Účet k jídelně není nastavený."""


class LoginFailed(Exception):
    """Jídelna přihlášení odmítla."""


def load_credentials() -> tuple[str, str] | None:
    email = os.environ.get("EJIDELNICEK_EMAIL", "").strip()
    password = os.environ.get("EJIDELNICEK_PASSWORD", "")
    if email and password:
        return email, password

    path = Path(os.environ.get("EJIDELNICEK_CREDENTIALS", ROOT / "credentials.json"))
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    file_email = str(data.get("email") or "").strip()
    file_password = str(data.get("password") or "")
    if not file_email or not file_password:
        return None
    return file_email, file_password


def require_credentials() -> tuple[str, str]:
    found = load_credentials()
    if found is None:
        raise CredentialsMissing()
    return found
