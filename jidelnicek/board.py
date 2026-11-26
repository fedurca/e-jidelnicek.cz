"""Složí týdenní přehled obědů z dat jídelny."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

PRAGUE = ZoneInfo("Europe/Prague")

WEEKDAYS = (
    "pondělí",
    "úterý",
    "středa",
    "čtvrtek",
    "pátek",
    "sobota",
    "neděle",
)
MONTHS = (
    "ledna",
    "února",
    "března",
    "dubna",
    "května",
    "června",
    "července",
    "srpna",
    "září",
    "října",
    "listopadu",
    "prosince",
)

NOT_ORDERED = {"N", "S", " ", ".", ""}
LUNCH_NAME = "Oběd"


@dataclass
class Button:
    label: str
    action: str
    menu_type_id: int | None
    confirm: str
    kind: str


@dataclass
class Dish:
    menu_type_id: int
    order_code: str
    type_name: str
    name: str
    orderable: bool
    selected: bool = False


@dataclass
class Cell:
    visitor_id: int
    child_name: str
    tone: str
    status: str
    mains: list[Dish] = field(default_factory=list)
    extras: list[Dish] = field(default_factory=list)
    buttons: list[Button] = field(default_factory=list)
    note: str = ""


@dataclass
class DayRow:
    date: date
    iso: str
    weekday: str
    day_label: str
    is_today: bool
    cells: list[Cell]


@dataclass
class OpenItem:
    child_name: str
    when: str
    dish: str
    anchor: str
    visitor_id: int
    iso: str
    menu_type_id: int
    confirm: str


@dataclass
class WeekView:
    key: str
    title: str
    range_label: str
    lead: str
    score: str
    rows: list[DayRow]


@dataclass
class ChildView:
    visitor_id: int
    given_name: str
    full_name: str
    class_label: str
    credit_label: str
    low_credit: bool


@dataclass
class Board:
    canteen_name: str
    updated_label: str
    rule: str
    children: list[ChildView]
    weeks: list[WeekView]
    still_open: list[OpenItem]
    empty: bool = False


def prague_date(value: str) -> date:
    text = value.replace("Z", "+00:00")
    moment = datetime.fromisoformat(text)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=PRAGUE)
    return moment.astimezone(PRAGUE).date()


def prague_midnight_iso(day: date) -> str:
    moment = datetime(day.year, day.month, day.day, tzinfo=PRAGUE)
    return moment.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def clean_name(name: str) -> str:
    text = re.sub(r"\s+", " ", name or "").strip()
    return re.sub(r"\s+,", ",", text)


def czech_name(names) -> str:
    if not isinstance(names, list):
        return ""
    for item in names:
        if isinstance(item, dict) and item.get("language") == "cs" and item.get("name"):
            return clean_name(item["name"])
    for item in names:
        if isinstance(item, dict) and item.get("name"):
            return clean_name(item["name"])
    return ""


def given_name(full_name: str) -> str:
    parts = [part for part in (full_name or "").replace(",", " ").split() if part]
    return parts[-1] if parts else "Dítě"


def class_label(value) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.isdigit():
        return f"{text}. třída"
    return text


def format_kc(value) -> str:
    amount = Decimal(str(value or "0")).quantize(Decimal("0.01"))
    sign = "−" if amount < 0 else ""
    amount = abs(amount)
    whole = int(amount)
    grouped = f"{whole:,}".replace(",", "\u00a0")
    if amount == amount.to_integral_value():
        return f"{sign}{grouped} Kč"
    fraction = f"{amount:.2f}".split(".")[1]
    return f"{sign}{grouped},{fraction} Kč"


def meal_count(count: int) -> str:
    if count == 1:
        return "1 oběd"
    if 2 <= count <= 4:
        return f"{count} obědy"
    return f"{count} obědů"


def _at_time(day: date, time_to: str) -> datetime:
    hour, minute, second = (int(part) for part in time_to.split(":"))
    return datetime(day.year, day.month, day.day, hour, minute, second, tzinfo=PRAGUE)


def deadline(day: date, limit: int, time_to: str, skip_closed: bool, char_at) -> datetime:
    """Stejné pravidlo jako e-Jídelníček: limit varných dnů zpět, v daný čas."""
    current = _at_time(day, time_to)
    counted = 0
    guard = 0
    while counted < max(limit, 0):
        current = _at_time(current.date() - timedelta(days=1), time_to)
        if not skip_closed or char_at(current.date()) != "*":
            counted += 1
        guard += 1
        if guard > 60:
            break
    return current


def _month_char(orders, visitor_id: int, diet_id: int, day: date) -> str | None:
    for record in orders:
        if record.get("visitor_id") != visitor_id or record.get("diet_id") != diet_id:
            continue
        record_day = prague_date(record["date"])
        if (record_day.year, record_day.month) != (day.year, day.month):
            continue
        ordered = record.get("data_ordered") or ""
        index = day.day - 1
        if index < 0 or index >= len(ordered):
            return None
        return ordered[index]
    return None


def _is_ordered(char: str | None) -> bool:
    return bool(char) and char not in NOT_ORDERED and char not in {"*", "B"}


def _choose_diet_id(child: dict, orders) -> int | None:
    used = [
        record["diet_id"]
        for record in orders
        if record.get("visitor_id") == child["id"] and record.get("diet_id")
    ]
    if used:
        return Counter(used).most_common(1)[0][0]
    for diet in child["diets"]:
        if diet["name"] == LUNCH_NAME:
            return diet["id"]
    return child["diets"][0]["id"] if child["diets"] else None


def _limits(child: dict, diet: dict) -> dict:
    if child.get("prefer_global"):
        return child["global_limits"]
    return diet


def _when(day: date) -> str:
    return f"{WEEKDAYS[day.weekday()]} {day.day}. {day.month}."


def _deadline_label(moment: datetime) -> str:
    return (
        f"{WEEKDAYS[moment.weekday()]} {moment.day}. {moment.month}. "
        f"v {moment.strftime('%H:%M')}"
    )


def _range_label(start: date, end: date) -> str:
    if start.month == end.month:
        return f"{start.day}.–{end.day}. {MONTHS[start.month - 1]}"
    return (
        f"{start.day}. {MONTHS[start.month - 1]} – "
        f"{end.day}. {MONTHS[end.month - 1]}"
    )


def _rule_text(limit: int, time_to: str, skip_closed: bool) -> str:
    clock = time_to[:5]
    if limit <= 0:
        return f"Objednávku lze měnit v den výdeje do {clock}."
    if limit == 1 and skip_closed:
        return (
            f"Objednat, změnit i zrušit oběd lze do {clock} "
            "poslední den, kdy se vaří, před výdejem."
        )
    if skip_closed:
        return (
            f"Objednávku lze měnit {meal_count(limit)} dopředu, "
            f"do {clock}, a počítají se jen dny, kdy se vaří."
        )
    return f"Objednávku lze měnit {limit} dní před výdejem do {clock}."


def _dishes_for(child: dict, menus, diet_id: int, day: date) -> tuple[list[Dish], list[Dish]]:
    types = {item["id"]: item for item in child["menu_types"]}
    mains: list[Dish] = []
    extras: list[Dish] = []
    seen = set()
    matched = []
    for menu in menus:
        if menu.get("canteen_id") != child["canteen_id"]:
            continue
        if menu.get("diet_id") != diet_id:
            continue
        if prague_date(menu["date"]) != day:
            continue
        if menu.get("menu_id") in seen:
            continue
        seen.add(menu.get("menu_id"))
        matched.append(menu)
    matched.sort(
        key=lambda menu: types.get(menu.get("menu_type_id"), {}).get("display_order", 0)
    )
    for menu in matched:
        info = types.get(menu.get("menu_type_id"), {})
        dish = Dish(
            menu_type_id=menu.get("menu_type_id") or 0,
            order_code="" if info.get("order_code") is None else str(info.get("order_code")),
            type_name=info.get("name") or "Jídlo",
            name=czech_name(menu.get("names")) or "Jídlo bez názvu",
            orderable=bool(info.get("can_be_ordered")),
        )
        if dish.orderable:
            mains.append(dish)
        else:
            extras.append(dish)
    return mains, extras


def _cell(
    child: dict,
    diet: dict,
    orders,
    menus,
    day: date,
    now: datetime,
) -> Cell:
    char = _month_char(orders, child["id"], diet["id"], day)
    mains, extras = _dishes_for(child, menus, diet["id"], day)
    limits = _limits(child, diet)
    skip_closed = bool(child.get("skip_closed"))

    def char_at(probe: date) -> str | None:
        return _month_char(orders, child["id"], diet["id"], probe)

    order_deadline = deadline(
        day, int(limits["order_limit_order"]), limits["order_time_to"], skip_closed, char_at
    )
    cancel_deadline = deadline(
        day, int(limits["order_limit_cancel"]), limits["cancel_time_to"], skip_closed, char_at
    )
    change_deadline = deadline(
        day, int(limits["order_limit_change"]), limits["change_time_to"], skip_closed, char_at
    )
    ordered = _is_ordered(char)
    selected = next((dish for dish in mains if dish.order_code == char), None)
    if selected:
        selected.selected = True

    cell = Cell(
        visitor_id=child["id"],
        child_name=child["given_name"],
        tone="closed",
        status="Neobjednáno",
        mains=mains,
        extras=extras,
    )

    if char == "*":
        cell.tone = "off"
        cell.status = "Nevaří se"
        cell.note = "Jídelna tento den nevaří."
        cell.mains = []
        return cell
    if char == "B":
        cell.tone = "closed"
        cell.status = "Blokováno"
        cell.note = "Objednávky na tento den jsou blokované."
        return cell
    if not mains and not extras and not ordered:
        cell.tone = "off"
        cell.status = "Bez jídelníčku"
        cell.note = "Jídelníček zatím není zveřejněný."
        return cell

    active = bool(child.get("ordering_active", True))

    def allowed(moment: datetime) -> bool:
        return active and now.date() <= day and moment >= now

    can_order = allowed(order_deadline)
    can_cancel = allowed(cancel_deadline)
    can_change = allowed(change_deadline)
    when = _when(day)

    if ordered:
        cell.tone = "ordered"
        cell.status = "Objednáno"
        if selected is None and char:
            cell.mains.insert(
                0,
                Dish(0, char, "Menu", f"Objednané menu {char}", False, True),
            )
        if can_cancel:
            cell.buttons.append(
                Button(
                    label="Zrušit objednávku",
                    action="cancel",
                    menu_type_id=None,
                    confirm=f"Zrušit oběd na {when}?",
                    kind="quiet",
                )
            )
            cell.note = f"Zrušit jde do {_deadline_label(cancel_deadline)}."
        else:
            cell.note = "Objednáno. Zrušit už nejde."
        if can_change:
            for dish in cell.mains:
                if dish.selected or not dish.orderable:
                    continue
                cell.buttons.append(
                    Button(
                        label=f"Změnit na {dish.type_name}",
                        action="change",
                        menu_type_id=dish.menu_type_id,
                        confirm=f"Změnit oběd na {when} na {dish.name}?",
                        kind="quiet",
                    )
                )
        return cell

    if can_order and mains:
        cell.tone = "open"
        cell.status = "Neobjednáno"
        cell.note = f"Objednat jde do {_deadline_label(order_deadline)}."
        for dish in mains:
            label = "Objednat" if len(mains) == 1 else f"Objednat {dish.type_name}"
            cell.buttons.append(
                Button(
                    label=label,
                    action="order",
                    menu_type_id=dish.menu_type_id,
                    confirm=f"Objednat na {when}: {dish.name}?",
                    kind="primary",
                )
            )
        return cell

    cell.tone = "closed"
    cell.status = "Neobjednáno"
    if now.date() > day:
        cell.note = "Ten den už proběhl."
    elif not active:
        cell.note = "Jídelna teď objednávání pozastavila."
    elif not mains:
        cell.note = "Na tento den není co objednat."
    else:
        cell.note = f"Objednávání skončilo {_deadline_label(order_deadline)}."
    return cell


def _week_lead(title: str, rows: list[DayRow], children: list[dict], today: date) -> tuple[str, str]:
    parts = []
    sentences = []
    all_zero = True
    for child in children:
        ordered = 0
        cooking = 0
        for row in rows:
            cell = next(item for item in row.cells if item.visitor_id == child["id"])
            if cell.tone == "off":
                continue
            cooking += 1
            if cell.tone == "ordered":
                ordered += 1
        all_zero = all_zero and ordered == 0
        parts.append(f"{child['given_name']} {ordered}/{cooking}")
        sentences.append(f"{child['given_name']} má {meal_count(ordered)}")
    score = " · ".join(parts)
    past = bool(rows) and all(row.date < today for row in rows)
    if all_zero:
        verb = "nebyl" if past else "není"
        lead = f"{title}: {verb} objednaný žádný oběd."
    else:
        lead = f"{title}: {', '.join(sentences)}."
    return lead, score


def build_board(children: list[dict], orders, menus, now: datetime | None = None) -> Board:
    moment = now.astimezone(PRAGUE) if now else datetime.now(PRAGUE)
    today = moment.date()
    if not children:
        return Board(
            canteen_name="",
            updated_label="",
            rule="",
            children=[],
            weeks=[],
            still_open=[],
            empty=True,
        )

    monday = today - timedelta(days=today.weekday())
    windows = (
        ("tento", "Tento týden", monday),
        ("pristi", "Příští týden", monday + timedelta(days=7)),
    )
    weeks: list[WeekView] = []
    still_open: list[OpenItem] = []
    sample_limits = None

    for key, title, start in windows:
        days = [start + timedelta(days=offset) for offset in range(5)]
        rows: list[DayRow] = []
        for day in days:
            cells = []
            for child in children:
                diet_id = _choose_diet_id(child, orders)
                diet = next((item for item in child["diets"] if item["id"] == diet_id), None)
                if diet is None:
                    cells.append(
                        Cell(
                            visitor_id=child["id"],
                            child_name=child["given_name"],
                            tone="off",
                            status="Bez diety",
                            note="U dítěte není nastavený oběd.",
                        )
                    )
                    continue
                if sample_limits is None:
                    sample_limits = (_limits(child, diet), bool(child.get("skip_closed")))
                cells.append(_cell(child, diet, orders, menus, day, moment))
            rows.append(
                DayRow(
                    date=day,
                    iso=day.isoformat(),
                    weekday=WEEKDAYS[day.weekday()],
                    day_label=f"{day.day}. {day.month}.",
                    is_today=day == today,
                    cells=cells,
                )
            )
            for cell in cells:
                if cell.tone != "open" or not cell.mains:
                    continue
                dish = cell.mains[0]
                still_open.append(
                    OpenItem(
                        child_name=cell.child_name,
                        when=_when(day),
                        dish=dish.name,
                        anchor=f"den-{day.isoformat()}",
                        visitor_id=cell.visitor_id,
                        iso=day.isoformat(),
                        menu_type_id=dish.menu_type_id,
                        confirm=f"Objednat na {_when(day)} pro {cell.child_name}: {dish.name}?",
                    )
                )
        lead, score = _week_lead(title, rows, children, today)
        weeks.append(
            WeekView(
                key=key,
                title=title,
                range_label=_range_label(days[0], days[-1]),
                lead=lead,
                score=score,
                rows=rows,
            )
        )

    if sample_limits:
        limits, skip_closed = sample_limits
        rule = _rule_text(int(limits["order_limit_order"]), limits["order_time_to"], skip_closed)
    else:
        rule = ""

    child_views = [
        ChildView(
            visitor_id=child["id"],
            given_name=child["given_name"],
            full_name=child["full_name"],
            class_label=child["class_label"],
            credit_label=format_kc(child["account"]),
            low_credit=bool(
                child.get("meal_price") is not None
                and Decimal(str(child["account"])) < Decimal(str(child["meal_price"]))
            ),
        )
        for child in children
    ]
    canteen_names = list(dict.fromkeys(child["canteen_name"] for child in children if child["canteen_name"]))
    updated = (
        f"ve {WEEKDAYS[moment.weekday()]} {moment.day}. {moment.month}. {moment.year} "
        f"v {moment.strftime('%H:%M')}"
    )
    return Board(
        canteen_name=" · ".join(canteen_names),
        updated_label=updated,
        rule=rule,
        children=child_views,
        weeks=weeks,
        still_open=still_open,
    )


def resolve_order(children: list[dict], orders, visitor_id: int, action: str, menu_type_id: int | None):
    child = next((item for item in children if item["id"] == visitor_id), None)
    if child is None:
        return None
    diet_id = _choose_diet_id(child, orders)
    if diet_id is None:
        return None
    if action == "cancel":
        return diet_id, "N"
    menu_type = next(
        (
            item
            for item in child["menu_types"]
            if item["id"] == menu_type_id and item["can_be_ordered"]
        ),
        None,
    )
    if menu_type is None or menu_type.get("order_code") is None:
        return None
    return diet_id, menu_type["order_code"]


def find_button(board: Board, visitor_id: int, day: date, action: str, menu_type_id: int | None):
    for week in board.weeks:
        for row in week.rows:
            if row.date != day:
                continue
            for cell in row.cells:
                if cell.visitor_id != visitor_id:
                    continue
                for button in cell.buttons:
                    if button.action != action:
                        continue
                    if action == "cancel" or button.menu_type_id == menu_type_id:
                        return button
    return None
