"""Klient e-Jídelníčku. Mluví se serverem jídelny stejným kanálem jako web."""

from __future__ import annotations

import threading
from datetime import date, datetime, timedelta
from decimal import Decimal

import socketio

from jidelnicek.board import PRAGUE, build_board, czech_name, given_name, class_label, prague_date, prague_midnight_iso
from jidelnicek.credentials import CredentialsMissing, LoginFailed, require_credentials
from jidelnicek.sanitize import strip_secrets

SERVER = "https://efood-server.altisima.cz"


class CanteenUnavailable(Exception):
    """Jídelna neodpověděla."""


def _utc_stamp(day: date) -> str:
    return f"{day.isoformat()}T00:00:00.000Z"


def _current_price(diet: dict, category_id: int, today: date):
    best = None
    for price in diet.get("prices") or []:
        if price.get("category_id") != category_id:
            continue
        try:
            start = prague_date(price["date_from"])
            amount = Decimal(str(price["price"]))
        except (KeyError, TypeError, ValueError):
            continue
        if start <= today and (best is None or start > best[0]):
            best = (start, amount)
    return None if best is None else best[1]


def project_children(user: dict, today: date) -> list[dict]:
    safe = strip_secrets(user)
    children = []
    for visitor in safe.get("visitors") or []:
        if visitor.get("deleted") or visitor.get("nestravuje_se"):
            continue
        canteen = visitor.get("canteen") or {}
        diets = []
        for diet in canteen.get("diets") or []:
            diets.append(
                {
                    "id": diet.get("diet_id"),
                    "name": czech_name(diet.get("names")),
                    "order_limit_order": int(diet.get("order_limit_order") or 0),
                    "order_limit_change": int(diet.get("order_limit_change") or 0),
                    "order_limit_cancel": int(diet.get("order_limit_cancel") or 0),
                    "order_time_to": diet.get("order_time_to") or "16:00:00",
                    "change_time_to": diet.get("change_time_to") or diet.get("order_time_to") or "16:00:00",
                    "cancel_time_to": diet.get("cancel_time_to") or diet.get("order_time_to") or "16:00:00",
                    "prices": diet.get("prices") or [],
                }
            )
        menu_types = []
        for item in canteen.get("menu_types") or []:
            menu_types.append(
                {
                    "id": item.get("menu_type_id"),
                    "name": czech_name(item.get("names")),
                    "order_code": item.get("order_code"),
                    "can_be_ordered": bool(item.get("can_be_ordered")),
                    "display_order": item.get("display_order") or 0,
                }
            )
        lunch = next((diet for diet in diets if diet["name"] == "Oběd"), None)
        price = _current_price(lunch, visitor.get("category_id"), today) if lunch else None
        children.append(
            {
                "id": visitor.get("visitor_id"),
                "full_name": visitor.get("name") or "Dítě",
                "given_name": given_name(visitor.get("name") or ""),
                "class_label": class_label(visitor.get("visitor_class")),
                "account": visitor.get("account") or "0",
                "meal_price": price,
                "category_id": visitor.get("category_id"),
                "canteen_id": visitor.get("canteen_id"),
                "canteen_name": canteen.get("name") or "",
                "ordering_active": bool(canteen.get("ordering_active", True)),
                "skip_closed": bool(canteen.get("order_limit_skip_closed_days")),
                "prefer_global": bool(canteen.get("prefer_global_order_limits")),
                "global_limits": {
                    "order_limit_order": int(canteen.get("order_limit_order") or 0),
                    "order_limit_change": int(canteen.get("order_limit_change") or 0),
                    "order_limit_cancel": int(canteen.get("order_limit_cancel") or 0),
                    "order_time_to": canteen.get("order_time_to") or "16:00:00",
                    "change_time_to": canteen.get("order_time_to") or "16:00:00",
                    "cancel_time_to": canteen.get("order_time_to") or "16:00:00",
                },
                "diets": diets,
                "menu_types": menu_types,
            }
        )
    return children


class CanteenClient:
    def __init__(self):
        self._lock = threading.Lock()
        self._sio: socketio.Client | None = None
        self._token = ""
        self._user_id = None

    def board(self):
        payload = self.snapshot()
        return build_board(payload["children"], payload["orders"], payload["menus"], payload["now"])

    def snapshot(self) -> dict:
        return self._overview()

    def place(
        self,
        visitor_id: int,
        day: date,
        diet_id: int,
        menu_type_id: int | None,
        order_code,
        action: str,
    ) -> dict:
        body = {
            "fakeNow": None,
            "day": prague_midnight_iso(day),
            "dietId": diet_id,
            "orderCode": order_code,
            "visitorId": visitor_id,
            "action": action,
        }
        if menu_type_id is not None:
            body["menuTypeId"] = menu_type_id
        with self._lock:
            result = self._api_locked(":user:orderMenu", body)
        if not isinstance(result, dict):
            raise CanteenUnavailable()
        return result

    def _overview(self) -> dict:
        today = datetime.now(PRAGUE).date()
        monday = today - timedelta(days=today.weekday())
        start = monday - timedelta(days=2)
        end = monday + timedelta(days=16)
        with self._lock:
            user = self._login_locked()
            children = project_children(user, today)
            visitor_ids = [child["id"] for child in children]
            orders = self._ok(
                self._api_locked(
                    ":fetchOrderData",
                    {"visitorsIds": visitor_ids, "from": _utc_stamp(start), "to": _utc_stamp(end)},
                )
            )
            menus = []
            for canteen_id in sorted({child["canteen_id"] for child in children}):
                batch = self._ok(
                    self._api_locked(
                        ":fetchMenus",
                        {"canteenId": canteen_id, "from": _utc_stamp(start), "to": _utc_stamp(end)},
                    )
                )
                for item in batch or []:
                    copied = dict(item)
                    copied["canteen_id"] = canteen_id
                    menus.append(copied)
        return {
            "children": children,
            "orders": orders or [],
            "menus": menus,
            "now": datetime.now(PRAGUE),
        }

    def _ok(self, result):
        if not isinstance(result, dict) or result.get("error"):
            raise CanteenUnavailable()
        return result.get("result")

    def _api_locked(self, event: str, payload: dict):
        self._ensure_locked()
        try:
            return self._emit(event, payload)
        except CanteenUnavailable:
            raise
        except Exception:
            self._drop_locked()
            self._ensure_locked()
            try:
                return self._emit(event, payload)
            except Exception as error:
                raise CanteenUnavailable() from error

    def _emit(self, event: str, payload: dict):
        if self._sio is None:
            raise CanteenUnavailable()
        return self._sio.call(
            "api",
            {
                "event": event,
                "token": self._token,
                "adminToken": None,
                "userId": self._user_id,
                "payload": payload,
            },
            timeout=30,
        )

    def _ensure_locked(self):
        if self._sio is not None and self._sio.connected and self._token:
            return
        self._login_locked()

    def _login_locked(self) -> dict:
        email, password = require_credentials()
        if self._sio is None or not self._sio.connected:
            self._drop_locked()
            client = socketio.Client(reconnection=False, logger=False, engineio_logger=False)
            try:
                client.connect(SERVER, transports=["polling"], wait_timeout=15)
            except Exception as error:
                raise CanteenUnavailable() from error
            self._sio = client
        try:
            result = self._sio.call(
                "api",
                {
                    "event": ":login",
                    "token": "",
                    "adminToken": None,
                    "userId": None,
                    "payload": {"email": email, "password": password},
                },
                timeout=30,
            )
        except Exception as error:
            self._drop_locked()
            raise CanteenUnavailable() from error
        finally:
            del password
        if not isinstance(result, dict) or result.get("error") or not (result.get("result") or {}).get("user"):
            self._token = ""
            self._user_id = None
            raise LoginFailed()
        user = result["result"]["user"]
        self._token = result["result"].get("token") or ""
        self._user_id = user.get("id")
        return user

    def _drop_locked(self):
        client = self._sio
        self._sio = None
        self._token = ""
        self._user_id = None
        if client is not None:
            try:
                client.disconnect()
            except Exception:
                pass
