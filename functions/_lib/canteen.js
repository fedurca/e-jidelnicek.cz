import { pragueYmd } from "./time.js";

const SERVER = "https://efood-server.altisima.cz/socket.io/";

export class CanteenError extends Error {}

function splitPackets(body) {
  return body.split("\u001e").filter(Boolean);
}

function parseMessage(packet) {
  if (!packet.startsWith("4")) return null;
  const sio = packet.slice(1);
  const type = sio[0];
  let index = 1;
  let id = "";
  while (index < sio.length && sio[index] >= "0" && sio[index] <= "9") {
    id += sio[index];
    index += 1;
  }
  const rest = sio.slice(index);
  return {
    type,
    id: id ? Number(id) : null,
    data: rest ? JSON.parse(rest) : null,
  };
}

export async function withCanteen(run) {
  const opened = await fetch(`${SERVER}?EIO=4&transport=polling`, {
    headers: { Origin: "https://e-jidelnicek.cz" },
  });
  if (!opened.ok) throw new CanteenError("Jídelna neodpověděla.");
  const openBody = await opened.text();
  const sid = JSON.parse(openBody.slice(1)).sid;
  const url = (extra = "") => `${SERVER}?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}${extra}`;
  let ack = 0;

  async function send(packets) {
    const response = await fetch(url(), {
      method: "POST",
      headers: {
        Origin: "https://e-jidelnicek.cz",
        "Content-Type": "text/plain;charset=UTF-8",
      },
      body: packets.join("\u001e"),
    });
    if (!response.ok) throw new CanteenError("Jídelna neodpověděla.");
  }

  async function poll() {
    const response = await fetch(url(`&t=${Date.now()}`), {
      headers: { Origin: "https://e-jidelnicek.cz" },
    });
    if (!response.ok) throw new CanteenError("Jídelna neodpověděla.");
    const packets = splitPackets(await response.text());
    if (packets.some((packet) => packet === "2")) await send(["3"]);
    return packets;
  }

  await send(["40"]);
  const started = Date.now();
  let connected = false;
  while (!connected && Date.now() - started < 10000) {
    const packets = await poll();
    connected = packets.some((packet) => packet.startsWith("40"));
  }
  if (!connected) throw new CanteenError("Jídelna neodpověděla.");

  async function call(event, payload, token = "", userId = null) {
    ack += 1;
    const id = ack;
    const body = JSON.stringify([
      "api",
      { event, token: token || "", adminToken: null, userId, payload },
    ]);
    await send([`42${id}${body}`]);
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      for (const packet of await poll()) {
        const message = parseMessage(packet);
        if (message?.type === "3" && message.id === id) {
          return Array.isArray(message.data) ? message.data[0] : message.data;
        }
      }
    }
    throw new CanteenError("Jídelna neodpověděla.");
  }

  try {
    return await run(call);
  } finally {
    try {
      await send(["41"]);
    } catch {
      /* spojení už může být zavřené */
    }
  }
}

function czechName(names) {
  if (!Array.isArray(names)) return "";
  const czech = names.find((item) => item?.language === "cs" && item.name);
  const any = names.find((item) => item?.name);
  return String((czech || any || {}).name || "").replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
}

function givenName(full) {
  const parts = String(full || "").replaceAll(",", " ").split(/\s+/).filter(Boolean);
  return parts.at(-1) || "Dítě";
}

function classLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^\d+$/.test(text) ? `${text}. třída` : text;
}

function priceFor(diet, categoryId, today) {
  let best = null;
  for (const price of diet?.prices || []) {
    if (price.category_id !== categoryId || !price.date_from) continue;
    const start = pragueYmd(new Date(price.date_from));
    const amount = Number(price.price);
    if (Number.isNaN(amount) || start > today) continue;
    if (!best || start > best.start) best = { start, amount };
  }
  return best ? best.amount : null;
}

export function projectChildren(user, today) {
  const children = [];
  for (const visitor of user?.visitors || []) {
    if (visitor.deleted || visitor.nestravuje_se) continue;
    const canteen = visitor.canteen || {};
    const diets = (canteen.diets || []).map((diet) => ({
      id: diet.diet_id,
      name: czechName(diet.names),
      order_limit_order: Number(diet.order_limit_order || 0),
      order_limit_change: Number(diet.order_limit_change || 0),
      order_limit_cancel: Number(diet.order_limit_cancel || 0),
      order_time_to: diet.order_time_to || "16:00:00",
      change_time_to: diet.change_time_to || diet.order_time_to || "16:00:00",
      cancel_time_to: diet.cancel_time_to || diet.order_time_to || "16:00:00",
      prices: diet.prices || [],
    }));
    const menuTypes = (canteen.menu_types || []).map((item) => ({
      id: item.menu_type_id,
      name: czechName(item.names),
      order_code: item.order_code,
      can_be_ordered: Boolean(item.can_be_ordered),
      display_order: item.display_order || 0,
    }));
    const lunch = diets.find((diet) => diet.name === "Oběd");
    children.push({
      id: visitor.visitor_id,
      full_name: visitor.name || "Dítě",
      given_name: givenName(visitor.name),
      class_label: classLabel(visitor.visitor_class),
      account: visitor.account || "0",
      meal_price: lunch ? priceFor(lunch, visitor.category_id, today) : null,
      category_id: visitor.category_id,
      canteen_id: visitor.canteen_id,
      canteen_name: canteen.name || "",
      ordering_active: canteen.ordering_active !== false,
      skip_closed: Boolean(canteen.order_limit_skip_closed_days),
      prefer_global: Boolean(canteen.prefer_global_order_limits),
      global_limits: {
        order_limit_order: Number(canteen.order_limit_order || 0),
        order_limit_change: Number(canteen.order_limit_change || 0),
        order_limit_cancel: Number(canteen.order_limit_cancel || 0),
        order_time_to: canteen.order_time_to || "16:00:00",
        change_time_to: canteen.order_time_to || "16:00:00",
        cancel_time_to: canteen.order_time_to || "16:00:00",
      },
      diets,
      menu_types: menuTypes,
    });
  }
  return children;
}
