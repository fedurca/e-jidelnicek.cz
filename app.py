"""Přehled obědů. Spuštění: uvicorn app:app --host 127.0.0.1 --port 8741"""

from __future__ import annotations

import os
import secrets
from datetime import date
from pathlib import Path
from urllib.parse import urlencode

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from jidelnicek.access import (
    client_ip,
    code_matches,
    gate_enabled,
    ip_allowed,
    load_code_hash,
    session_matches,
    session_token,
    trust_proxy,
)
from jidelnicek.board import build_board, find_button, resolve_order
from jidelnicek.client import CanteenClient, CanteenUnavailable
from jidelnicek.credentials import CredentialsMissing, LoginFailed

ROOT = Path(__file__).resolve().parent
CSRF_COOKIE = "obed_csrf"
SESSION_COOKIE = "obed_vstup"
OPEN_PATHS = {"/vstup", "/zdravi"}

app = FastAPI(title="Obědy", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
templates = Jinja2Templates(directory=ROOT / "templates")
client = CanteenClient()


def _seen_ip(request: Request) -> str:
    return client_ip(
        request.client.host if request.client else "",
        request.headers.get("x-forwarded-for"),
        trust_proxy(),
    )


def _session_ok(request: Request) -> bool:
    digest = load_code_hash()
    if not digest:
        return True
    return session_matches(request.cookies.get(SESSION_COOKIE, ""), digest)


@app.middleware("http")
async def allow_only_home(request: Request, call_next):
    if not gate_enabled():
        return await call_next(request)
    ip = _seen_ip(request)
    if not ip_allowed(ip):
        page = templates.TemplateResponse(
            request,
            "message.html",
            {
                "kind": "bad",
                "title": "Sem to z téhle adresy nejde",
                "text": f"Připojení z {ip or 'neznámé adresy'} sem nepouštíme.",
            },
            status_code=403,
        )
        return page
    if request.url.path.startswith("/static") or request.url.path in OPEN_PATHS:
        return await call_next(request)
    if _session_ok(request):
        return await call_next(request)
    return RedirectResponse("/vstup", status_code=303)

SUCCESS = {
    "order": ("objednano", "oběd je objednaný."),
    "change": ("zmeneno", "objednávka je změněná."),
    "cancel": ("zruseno", "objednávka je zrušená."),
}
PROBLEMS = {
    "uzavreno": "Tahle objednávka už není otevřená. Stránka ukazuje aktuální stav.",
    "jidelna": "Jídelna objednávku odmítla. Zkuste to znovu.",
    "spojeni": "Spojení s jídelnou vypadlo. Zkuste to znovu.",
    ":ORDERS_NOT_ALLOWED": "Objednávky na tento měsíc ještě nejsou povolené.",
    ":ORDERS_BLOCKED": "Objednávky na tento den jsou blokované.",
    ":ORDERS_NOT_COOKING_DAY": "Tento den se nevaří.",
    ":ORDERS_TOO_LATE": "Na tento den už objednat nejde.",
    ":ORDERS_MAX_MENU": "Tohle menu pro dítě objednat nejde.",
    ":ORDERS_CANNOT_ORDER": "Objednat už nejde, termín vypršel.",
    ":ORDERS_CANNOT_CHANGE": "Objednávku už nejde změnit.",
    ":ORDERS_CANNOT_CANCEL": "Objednávku už nejde zrušit.",
    ":ORDERS_FORBIDDEN_FOR_CANTEEN": "Jídelna teď objednávání pozastavila. Zkuste to za chvíli.",
    ":ORDERS_NO_MONEY": "Na účtě není dost kreditu.",
}


def _secure(request: Request) -> bool:
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    return proto == "https"


def _csrf(request: Request) -> str:
    return request.cookies.get(CSRF_COOKIE) or secrets.token_urlsafe(32)


def _set_csrf(response, request: Request, token: str):
    response.set_cookie(
        CSRF_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=_secure(request),
        max_age=60 * 60 * 24 * 14,
        path="/",
    )
    return response


def _message_page(request: Request, token: str, *, kind: str, title: str, text: str, status: int = 200):
    response = templates.TemplateResponse(
        request,
        "message.html",
        {"kind": kind, "title": title, "text": text},
        status_code=status,
    )
    return _set_csrf(response, request, token)


def _flash(code: str, problem: str, child_id: str, board) -> dict | None:
    if code in {"objednano", "zmeneno", "zruseno"}:
        tail = {
            "objednano": "má oběd objednaný.",
            "zmeneno": "má objednávku změněnou.",
            "zruseno": "má objednávku zrušenou.",
        }[code]
        name = ""
        if child_id.isdigit():
            match = next((child for child in board.children if child.visitor_id == int(child_id)), None)
            if match:
                name = match.given_name
        text = f"{name} {tail}" if name else tail[:1].upper() + tail[1:]
        return {"kind": "ok", "text": text}
    if code == "chyba":
        return {"kind": "bad", "text": PROBLEMS.get(problem, PROBLEMS["jidelna"])}
    return None


def _redirect(code: str, problem: str = "", child_id: int | None = None):
    query = {"zprava": code}
    if problem:
        query["kod"] = problem
    if child_id is not None:
        query["dite"] = str(child_id)
    return RedirectResponse("/?" + urlencode(query), status_code=303)


@app.get("/zdravi")
def health():
    return {"ok": True}


@app.get("/vstup", response_class=HTMLResponse)
def enter_form(request: Request):
    if not gate_enabled():
        return RedirectResponse("/", status_code=303)
    token = _csrf(request)
    response = templates.TemplateResponse(
        request,
        "login.html",
        {"csrf": token, "error": ""},
    )
    return _set_csrf(response, request, token)


@app.post("/vstup")
def enter(request: Request, csrf: str = Form(""), kod: str = Form("")):
    digest = load_code_hash()
    if not digest:
        return RedirectResponse("/", status_code=303)
    expected = request.cookies.get(CSRF_COOKIE, "")
    csrf_ok = bool(expected) and len(expected) == len(csrf) and secrets.compare_digest(expected, csrf)
    token = _csrf(request)
    if not csrf_ok or not code_matches(kod, digest):
        response = templates.TemplateResponse(
            request,
            "login.html",
            {"csrf": token, "error": "Kód nesedí."},
            status_code=401 if csrf_ok else 403,
        )
        return _set_csrf(response, request, token)
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        SESSION_COOKIE,
        session_token(digest),
        httponly=True,
        samesite="lax",
        secure=_secure(request),
        max_age=60 * 60 * 24 * 30,
        path="/",
    )
    return _set_csrf(response, request, token)


@app.get("/", response_class=HTMLResponse)
def index(request: Request, zprava: str = "", kod: str = "", dite: str = ""):
    token = _csrf(request)
    try:
        board = client.board()
    except CredentialsMissing:
        return _message_page(
            request,
            token,
            kind="setup",
            title="Chybí přihlášení do jídelny",
            text=(
                "Aplikace se hlásí do e-Jídelníčku e-mailem a heslem rodiče. "
                "Lokálně je uložte do souboru credentials.json vedle programu. "
                "Vzor je v credentials.example.json. "
                "Na serveru nastavte proměnné EJIDELNICEK_EMAIL a EJIDELNICEK_PASSWORD."
            ),
        )
    except LoginFailed:
        return _message_page(
            request,
            token,
            kind="bad",
            title="Jídelna přihlášení odmítla",
            text="Zkontrolujte e-mail a heslo v credentials.json, nebo v proměnných EJIDELNICEK_EMAIL a EJIDELNICEK_PASSWORD.",
            status=502,
        )
    except CanteenUnavailable:
        return _message_page(
            request,
            token,
            kind="bad",
            title="Jídelna teď neodpovídá",
            text="Spojení s e-Jídelníčkem se nepovedlo. Zkuste stránku obnovit.",
            status=502,
        )
    response = templates.TemplateResponse(
        request,
        "index.html",
        {"board": board, "flash": _flash(zprava, kod, dite, board), "csrf": token},
    )
    return _set_csrf(response, request, token)


@app.post("/objednat")
def order(
    request: Request,
    csrf: str = Form(""),
    visitor_id: int = Form(...),
    day: str = Form(...),
    action: str = Form(...),
    menu_type_id: str = Form(""),
):
    expected = request.cookies.get(CSRF_COOKIE, "")
    csrf_ok = bool(expected) and len(expected) == len(csrf) and secrets.compare_digest(expected, csrf)
    if not csrf_ok:
        return _message_page(
            request,
            _csrf(request),
            kind="bad",
            title="Objednávku se nepodařilo odeslat",
            text="Otevřete přehled znovu a akci zopakujte.",
            status=403,
        )
    if action not in SUCCESS:
        return _redirect("chyba", "uzavreno")
    try:
        target_day = date.fromisoformat(day)
    except ValueError:
        return _redirect("chyba", "uzavreno")
    menu_id = int(menu_type_id) if menu_type_id.strip().isdigit() else None
    if action != "cancel" and menu_id is None:
        return _redirect("chyba", "uzavreno", visitor_id)

    try:
        snapshot = client.snapshot()
        current = build_board(
            snapshot["children"], snapshot["orders"], snapshot["menus"], snapshot["now"]
        )
        if find_button(current, visitor_id, target_day, action, menu_id) is None:
            return _redirect("chyba", "uzavreno", visitor_id)
        resolved = resolve_order(snapshot["children"], snapshot["orders"], visitor_id, action, menu_id)
        if resolved is None:
            return _redirect("chyba", "uzavreno", visitor_id)
        diet_id, order_code = resolved
        result = client.place(visitor_id, target_day, diet_id, menu_id, order_code, action)
    except (CredentialsMissing, LoginFailed):
        return _redirect("chyba", "jidelna", visitor_id)
    except CanteenUnavailable:
        return _redirect("chyba", "spojeni", visitor_id)

    if not isinstance(result, dict) or result.get("error"):
        detail = result.get("detail") if isinstance(result, dict) else None
        return _redirect("chyba", detail or "jidelna", visitor_id)
    return _redirect(SUCCESS[action][0], child_id=visitor_id)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8741"))
    uvicorn.run("app:app", host="0.0.0.0", port=port)
