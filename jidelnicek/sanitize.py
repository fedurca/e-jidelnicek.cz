"""Odstraní přihlašovací údaje dřív, než data opustí klienta jídelny."""

_SECRET_PARTS = ("password", "passwd", "pin", "token", "rfid", "secret")


def is_secret_key(key: str) -> bool:
    lowered = key.lower()
    if lowered in {"login_name", "login_password"}:
        return True
    return any(part in lowered for part in _SECRET_PARTS)


def strip_secrets(value):
    if isinstance(value, dict):
        return {
            key: strip_secrets(item)
            for key, item in value.items()
            if not is_secret_key(key)
        }
    if isinstance(value, list):
        return [strip_secrets(item) for item in value]
    return value
