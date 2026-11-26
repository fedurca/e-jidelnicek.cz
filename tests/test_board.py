from datetime import date, datetime
from decimal import Decimal

from jidelnicek.board import (
    PRAGUE,
    build_board,
    deadline,
    find_button,
    format_kc,
    given_name,
    prague_date,
)
from jidelnicek.sanitize import strip_secrets


def test_prague_dates_match_canteen_storage():
    assert prague_date("2026-10-31T23:00:00.000Z") == date(2026, 11, 1)
    assert prague_date("2026-11-24T23:00:00.000Z") == date(2026, 11, 25)


def test_names_and_money():
    assert given_name("Fedurcová Lily") == "Lily"
    assert format_kc("116.00") == "116 Kč"
    assert format_kc("1160.5") == "1\u00a0160,50 Kč"


def test_secrets_never_pass_through():
    cleaned = strip_secrets(
        {
            "name": "Nikola",
            "login_password": "1234",
            "login_name": "nick",
            "canteen": {"email": "jidelna@skola.cz", "login_password": "tajne", "rfid": "abc"},
        }
    )
    assert cleaned == {"name": "Nikola", "canteen": {"email": "jidelna@skola.cz"}}


def _month(year, month, days, marks):
    chars = []
    for day in range(1, days + 1):
        current = date(year, month, day)
        if current in marks:
            chars.append(marks[current])
        elif current.weekday() >= 5:
            chars.append("*")
        else:
            chars.append("N")
    return "".join(chars)


def _child():
    return {
        "id": 7,
        "full_name": "Nováková Ema",
        "given_name": "Ema",
        "class_label": "5. třída",
        "account": "80.00",
        "meal_price": Decimal("40"),
        "category_id": 1,
        "canteen_id": 3,
        "canteen_name": "Školní jídelna",
        "ordering_active": True,
        "skip_closed": True,
        "prefer_global": False,
        "global_limits": {},
        "diets": [
            {
                "id": 607,
                "name": "Oběd",
                "order_limit_order": 1,
                "order_limit_change": 1,
                "order_limit_cancel": 1,
                "order_time_to": "16:00:00",
                "change_time_to": "16:00:00",
                "cancel_time_to": "16:00:00",
            }
        ],
        "menu_types": [
            {"id": 10, "name": "Polévka", "order_code": 0, "can_be_ordered": False, "display_order": 1},
            {"id": 11, "name": "Menu 1", "order_code": 1, "can_be_ordered": True, "display_order": 2},
        ],
    }


def _menu(day, type_id, name):
    return {
        "menu_id": int(day.strftime("%Y%m%d")) + type_id,
        "menu_type_id": type_id,
        "diet_id": 607,
        "canteen_id": 3,
        "date": f"{day.isoformat()}T00:00:00.000Z",
        "names": [{"language": "cs", "name": name}],
    }


def test_deadline_skips_weekend():
    def char_at(day):
        return "*" if day.weekday() >= 5 else "N"

    # Pondělí 30. 11. 2026 se objednává do pátku 27. 11. 16:00.
    moment = deadline(date(2026, 11, 30), 1, "16:00:00", True, char_at)
    assert moment == datetime(2026, 11, 27, 16, 0, tzinfo=PRAGUE)
    # Pátek 27. 11. se objednává do čtvrtka 26. 11. 16:00.
    moment = deadline(date(2026, 11, 27), 1, "16:00:00", True, char_at)
    assert moment == datetime(2026, 11, 26, 16, 0, tzinfo=PRAGUE)


def test_board_shows_open_and_ordered_days():
    child = _child()
    orders = [
        {
            "visitor_id": 7,
            "diet_id": 607,
            "date": "2026-10-31T23:00:00.000Z",
            "data_ordered": _month(2026, 11, 30, {}),
        },
        {
            "visitor_id": 7,
            "diet_id": 607,
            "date": "2026-11-30T23:00:00.000Z",
            "data_ordered": _month(2026, 12, 31, {date(2026, 12, 2): "1", date(2026, 12, 3): "1"}),
        },
    ]
    menus = []
    for day, soup, main in (
        (date(2026, 11, 27), "Vývar", "Čevabčiči"),
        (date(2026, 11, 30), "Vývar", "Dukátové buchtičky"),
        (date(2026, 12, 2), "Polévka", "Karbanátek"),
    ):
        menus.append(_menu(day, 10, soup))
        menus.append(_menu(day, 11, main))
    now = datetime(2026, 11, 26, 18, 0, tzinfo=PRAGUE)
    board = build_board([child], orders, menus, now)

    this_week = {row.date: row.cells[0] for row in board.weeks[0].rows}
    next_week = {row.date: row.cells[0] for row in board.weeks[1].rows}
    assert this_week[date(2026, 11, 27)].tone == "closed"
    assert this_week[date(2026, 11, 27)].mains[0].name == "Čevabčiči"
    assert next_week[date(2026, 11, 30)].tone == "open"
    assert find_button(board, 7, date(2026, 11, 30), "order", 11) is not None
    assert find_button(board, 7, date(2026, 11, 27), "order", 11) is None
    assert next_week[date(2026, 12, 2)].tone == "ordered"
    assert next_week[date(2026, 12, 2)].mains[0].name == "Karbanátek"
    assert any(item.dish == "Dukátové buchtičky" for item in board.still_open)
    assert board.children[0].credit_label == "80 Kč"
    assert board.children[0].low_credit is False
