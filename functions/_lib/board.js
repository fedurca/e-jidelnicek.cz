import {
  addDays,
  compareYmd,
  dayLabel,
  mondayOf,
  pragueClock,
  pragueInstant,
  pragueYmd,
  rangeLabel,
  weekdayName,
  whenLabel,
} from "./time.js";

const NOT_ORDERED = new Set(["N", "S", " ", ".", ""]);

function cleanName(name) {
  return String(name || "").replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
}

export function czechName(names) {
  if (!Array.isArray(names)) return "";
  const czech = names.find((item) => item?.language === "cs" && item.name);
  const any = names.find((item) => item?.name);
  return cleanName((czech || any || {}).name || "");
}

function mealCount(count) {
  if (count === 1) return "1 oběd";
  if (count >= 2 && count <= 4) return `${count} obědy`;
  return `${count} obědů`;
}

export function formatKc(value) {
  const amount = Number(value || 0);
  const sign = amount < 0 ? "−" : "";
  const abs = Math.abs(amount);
  const whole = Math.trunc(abs);
  const grouped = whole.toLocaleString("fr-FR").replaceAll("\u202f", "\u00a0").replaceAll(" ", "\u00a0");
  if (Math.abs(abs - whole) < 0.001) return `${sign}${grouped} Kč`;
  const fraction = abs.toFixed(2).split(".")[1];
  return `${sign}${grouped},${fraction} Kč`;
}

function monthChar(orders, visitorId, dietId, ymd) {
  for (const record of orders) {
    if (record.visitor_id !== visitorId || record.diet_id !== dietId) continue;
    const recordDay = pragueYmd(new Date(record.date));
    if (recordDay.slice(0, 7) !== ymd.slice(0, 7)) continue;
    const index = Number(ymd.slice(8, 10)) - 1;
    const ordered = record.data_ordered || "";
    if (index < 0 || index >= ordered.length) return null;
    return ordered[index];
  }
  return null;
}

function isOrdered(char) {
  return Boolean(char) && !NOT_ORDERED.has(char) && char !== "*" && char !== "B";
}

function chooseDietId(child, orders) {
  const counts = new Map();
  for (const record of orders) {
    if (record.visitor_id !== child.id || !record.diet_id) continue;
    counts.set(record.diet_id, (counts.get(record.diet_id) || 0) + 1);
  }
  let best = null;
  for (const [id, count] of counts) {
    if (!best || count > best.count) best = { id, count };
  }
  if (best) return best.id;
  return (child.diets.find((diet) => diet.name === "Oběd") || child.diets[0])?.id ?? null;
}

function limitsFor(child, diet) {
  return child.prefer_global ? child.global_limits : diet;
}

function deadline(ymd, limit, timeTo, skipClosed, charAt) {
  let current = ymd;
  let counted = 0;
  let guard = 0;
  while (counted < Math.max(limit, 0)) {
    current = addDays(current, -1);
    if (!skipClosed || charAt(current) !== "*") counted += 1;
    guard += 1;
    if (guard > 60) break;
  }
  return pragueInstant(current, timeTo || "16:00:00");
}

function dishesFor(child, menus, dietId, ymd) {
  const types = new Map(child.menu_types.map((item) => [item.id, item]));
  const matched = [];
  const seen = new Set();
  for (const menu of menus) {
    if (menu.canteen_id !== child.canteen_id || menu.diet_id !== dietId) continue;
    if (pragueYmd(new Date(menu.date)) !== ymd) continue;
    if (seen.has(menu.menu_id)) continue;
    seen.add(menu.menu_id);
    matched.push(menu);
  }
  matched.sort((a, b) => (types.get(a.menu_type_id)?.display_order || 0) - (types.get(b.menu_type_id)?.display_order || 0));
  const mains = [];
  const extras = [];
  for (const menu of matched) {
    const info = types.get(menu.menu_type_id) || {};
    const dish = {
      menu_type_id: menu.menu_type_id || 0,
      order_code: info.order_code == null ? "" : String(info.order_code),
      type_name: info.name || "Jídlo",
      name: czechName(menu.names) || "Jídlo bez názvu",
      orderable: Boolean(info.can_be_ordered),
      selected: false,
    };
    (dish.orderable ? mains : extras).push(dish);
  }
  return { mains, extras };
}

function deadlineLabel(moment) {
  const ymd = pragueYmd(moment);
  return `${whenLabel(ymd)} v ${pragueClock(moment)}`;
}

function cellFor(child, diet, orders, menus, ymd, now) {
  const char = monthChar(orders, child.id, diet.id, ymd);
  const { mains, extras } = dishesFor(child, menus, diet.id, ymd);
  const limits = limitsFor(child, diet);
  const charAt = (probe) => monthChar(orders, child.id, diet.id, probe);
  const orderDeadline = deadline(ymd, limits.order_limit_order, limits.order_time_to, child.skip_closed, charAt);
  const cancelDeadline = deadline(ymd, limits.order_limit_cancel, limits.cancel_time_to, child.skip_closed, charAt);
  const changeDeadline = deadline(ymd, limits.order_limit_change, limits.change_time_to, child.skip_closed, charAt);
  const selected = mains.find((dish) => dish.order_code === char);
  if (selected) selected.selected = true;
  const cell = {
    visitor_id: child.id,
    child_name: child.given_name,
    tone: "closed",
    status: "Neobjednáno",
    mains,
    extras,
    buttons: [],
    note: "",
  };
  if (char === "*") {
    return { ...cell, tone: "off", status: "Nevaří se", note: "Jídelna tento den nevaří.", mains: [] };
  }
  if (char === "B") {
    return { ...cell, status: "Blokováno", note: "Objednávky na tento den jsou blokované." };
  }
  if (!mains.length && !extras.length && !isOrdered(char)) {
    return { ...cell, tone: "off", status: "Bez jídelníčku", note: "Jídelníček zatím není zveřejněný." };
  }
  const today = pragueYmd(now);
  const allowed = (moment) => child.ordering_active !== false && compareYmd(today, ymd) <= 0 && moment.getTime() >= now.getTime();
  const when = whenLabel(ymd);
  if (isOrdered(char)) {
    const nextMains = selected || !char ? mains : [{ menu_type_id: 0, order_code: char, type_name: "Menu", name: `Objednané menu ${char}`, orderable: false, selected: true }, ...mains];
    const buttons = [];
    let note = "Objednáno. Zrušit už nejde.";
    if (allowed(cancelDeadline)) {
      buttons.push({ label: "Zrušit objednávku", action: "cancel", menu_type_id: null, confirm: `Zrušit oběd na ${when}?`, kind: "quiet" });
      note = `Zrušit jde do ${deadlineLabel(cancelDeadline)}.`;
    }
    if (allowed(changeDeadline)) {
      for (const dish of nextMains) {
        if (dish.selected || !dish.orderable) continue;
        buttons.push({
          label: `Změnit na ${dish.type_name}`,
          action: "change",
          menu_type_id: dish.menu_type_id,
          confirm: `Změnit oběd na ${when} na ${dish.name}?`,
          kind: "quiet",
        });
      }
    }
    return { ...cell, tone: "ordered", status: "Objednáno", mains: nextMains, buttons, note };
  }
  if (allowed(orderDeadline) && mains.length) {
    return {
      ...cell,
      tone: "open",
      note: `Objednat jde do ${deadlineLabel(orderDeadline)}.`,
      buttons: mains.map((dish) => ({
        label: mains.length === 1 ? "Objednat" : `Objednat ${dish.type_name}`,
        action: "order",
        menu_type_id: dish.menu_type_id,
        confirm: `Objednat na ${when}: ${dish.name}?`,
        kind: "primary",
      })),
    };
  }
  let note = `Objednávání skončilo ${deadlineLabel(orderDeadline)}.`;
  if (compareYmd(today, ymd) > 0) note = "Ten den už proběhl.";
  else if (child.ordering_active === false) note = "Jídelna teď objednávání pozastavila.";
  else if (!mains.length) note = "Na tento den není co objednat.";
  return { ...cell, note };
}

function weekLead(title, rows, children, today) {
  const sentences = [];
  const parts = [];
  let allZero = true;
  for (const child of children) {
    let ordered = 0;
    let cooking = 0;
    for (const row of rows) {
      const cell = row.cells.find((item) => item.visitor_id === child.id);
      if (cell.tone === "off") continue;
      cooking += 1;
      if (cell.tone === "ordered") ordered += 1;
    }
    allZero &&= ordered === 0;
    parts.push(`${child.given_name} ${ordered}/${cooking}`);
    sentences.push(`${child.given_name} má ${mealCount(ordered)}`);
  }
  const past = rows.length > 0 && rows.every((row) => compareYmd(row.date, today) < 0);
  const lead = allZero
    ? `${title}: ${past ? "nebyl" : "není"} objednaný žádný oběd.`
    : `${title}: ${sentences.join(", ")}.`;
  return { lead, score: parts.join(" · ") };
}

export function buildBoard(children, orders, menus, now = new Date()) {
  const today = pragueYmd(now);
  if (!children.length) {
    return { canteen_name: "", updated_label: "", rule: "", children: [], weeks: [], still_open: [], empty: true };
  }
  const monday = mondayOf(today);
  const windows = [
    ["tento", "Tento týden", monday],
    ["pristi", "Příští týden", addDays(monday, 7)],
  ];
  const weeks = [];
  const stillOpen = [];
  let sample = null;
  for (const [key, title, start] of windows) {
    const days = Array.from({ length: 5 }, (_, index) => addDays(start, index));
    const rows = days.map((ymd) => {
      const cells = children.map((child) => {
        const dietId = chooseDietId(child, orders);
        const diet = child.diets.find((item) => item.id === dietId);
        if (!diet) {
          return {
            visitor_id: child.id,
            child_name: child.given_name,
            tone: "off",
            status: "Bez diety",
            mains: [],
            extras: [],
            buttons: [],
            note: "U dítěte není nastavený oběd.",
          };
        }
        if (!sample) sample = { limits: limitsFor(child, diet), skip: child.skip_closed };
        return cellFor(child, diet, orders, menus, ymd, now);
      });
      for (const cell of cells) {
        if (cell.tone !== "open" || !cell.mains.length) continue;
        stillOpen.push({
          child_name: cell.child_name,
          when: whenLabel(ymd),
          dish: cell.mains[0].name,
          anchor: `den-${ymd}`,
          visitor_id: cell.visitor_id,
          iso: ymd,
          menu_type_id: cell.mains[0].menu_type_id,
          confirm: `Objednat na ${whenLabel(ymd)} pro ${cell.child_name}: ${cell.mains[0].name}?`,
        });
      }
      return {
        date: ymd,
        iso: ymd,
        weekday: weekdayName(ymd),
        day_label: dayLabel(ymd),
        is_today: ymd === today,
        cells,
      };
    });
    weeks.push({ key, title, range_label: rangeLabel(days[0], days.at(-1)), ...weekLead(title, rows, children, today), rows });
  }
  const rule = sample
    ? ruleText(sample.limits.order_limit_order, sample.limits.order_time_to, sample.skip)
    : "";
  return {
    canteen_name: [...new Set(children.map((child) => child.canteen_name).filter(Boolean))].join(" · "),
    updated_label: `ve ${weekdayName(today)} ${dayLabel(today)} ${today.slice(0, 4)} v ${pragueClock(now)}`,
    rule,
    children: children.map((child) => ({
      visitor_id: child.id,
      given_name: child.given_name,
      full_name: child.full_name,
      class_label: child.class_label,
      credit_label: formatKc(child.account),
      low_credit: child.meal_price != null && Number(child.account) < Number(child.meal_price),
    })),
    weeks,
    still_open: stillOpen,
    empty: false,
  };
}

function ruleText(limit, timeTo, skipClosed) {
  const clock = String(timeTo || "16:00:00").slice(0, 5);
  if (limit <= 0) return `Objednávku lze měnit v den výdeje do ${clock}.`;
  if (limit === 1 && skipClosed) {
    return `Objednat, změnit i zrušit oběd lze do ${clock} poslední den, kdy se vaří, před výdejem.`;
  }
  if (skipClosed) return `Objednávku lze měnit ${mealCount(limit)} dopředu, do ${clock}, a počítají se jen dny, kdy se vaří.`;
  return `Objednávku lze měnit ${limit} dní před výdejem do ${clock}.`;
}

export function findButton(board, visitorId, ymd, action, menuTypeId) {
  for (const week of board.weeks) {
    for (const row of week.rows) {
      if (row.date !== ymd) continue;
      for (const cell of row.cells) {
        if (cell.visitor_id !== visitorId) continue;
        for (const button of cell.buttons) {
          if (button.action !== action) continue;
          if (action === "cancel" || button.menu_type_id === menuTypeId) return button;
        }
      }
    }
  }
  return null;
}

export function resolveOrder(children, orders, visitorId, action, menuTypeId) {
  const child = children.find((item) => item.id === visitorId);
  if (!child) return null;
  const dietId = chooseDietId(child, orders);
  if (dietId == null) return null;
  if (action === "cancel") return { dietId, orderCode: "N" };
  const menuType = child.menu_types.find((item) => item.id === menuTypeId && item.can_be_ordered);
  if (!menuType || menuType.order_code == null) return null;
  return { dietId, orderCode: menuType.order_code };
}
