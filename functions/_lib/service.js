import { buildBoard, findButton, resolveOrder } from "./board.js";
import { CanteenError, projectChildren, withCanteen } from "./canteen.js";
import { secret } from "./runtime-store.js";
import { addDays, mondayOf, pragueMidnightIso, pragueYmd } from "./time.js";

export class AppError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function stamp(ymd) {
  return `${ymd}T00:00:00.000Z`;
}

function canteenLogin(env, data) {
  const email = secret(env, data, "EJIDELNICEK_EMAIL");
  const password = secret(env, data, "EJIDELNICEK_PASSWORD");
  if (!email || !password) throw new AppError("credentials");
  return { email, password };
}

export async function loadSnapshot(env, data) {
  const loginBody = canteenLogin(env, data);
  try {
    return await withCanteen(async (call) => {
      const login = await call(":login", loginBody);
      if (!login || login.error || !login.result?.user) throw new AppError("login");
      const token = login.result.token || "";
      const userId = login.result.user.id;
      const today = pragueYmd();
      const start = addDays(mondayOf(today), -2);
      const end = addDays(mondayOf(today), 16);
      const children = projectChildren(login.result.user, today);
      const orders = await call(
        ":fetchOrderData",
        { visitorsIds: children.map((child) => child.id), from: stamp(start), to: stamp(end) },
        token,
        userId,
      );
      if (!orders || orders.error) throw new AppError("canteen");
      const menus = [];
      for (const canteenId of [...new Set(children.map((child) => child.canteen_id))]) {
        const batch = await call(":fetchMenus", { canteenId, from: stamp(start), to: stamp(end) }, token, userId);
        if (!batch || batch.error) throw new AppError("canteen");
        for (const item of batch.result || []) menus.push({ ...item, canteen_id: canteenId });
      }
      return { children, orders: orders.result || [], menus };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof CanteenError) throw new AppError("canteen");
    throw new AppError("canteen");
  }
}

export async function currentBoard(env, data) {
  const snapshot = await loadSnapshot(env, data);
  return { snapshot, board: buildBoard(snapshot.children, snapshot.orders, snapshot.menus, new Date()) };
}

export async function placeOrder(env, data, { visitorId, day, action, menuTypeId }) {
  const snapshot = await loadSnapshot(env, data);
  const board = buildBoard(snapshot.children, snapshot.orders, snapshot.menus, new Date());
  if (!findButton(board, visitorId, day, action, menuTypeId)) return { ok: false, code: "uzavreno" };
  const resolved = resolveOrder(snapshot.children, snapshot.orders, visitorId, action, menuTypeId);
  if (!resolved) return { ok: false, code: "uzavreno" };
  try {
    const result = await withCanteen(async (call) => {
      const login = await call(":login", canteenLogin(env, data));
      if (!login || login.error) throw new AppError("login");
      const body = {
        fakeNow: null,
        day: pragueMidnightIso(day),
        dietId: resolved.dietId,
        orderCode: resolved.orderCode,
        visitorId,
        action,
      };
      if (menuTypeId != null) body.menuTypeId = menuTypeId;
      return call(":user:orderMenu", body, login.result.token, login.result.user.id);
    });
    if (!result || result.error) return { ok: false, code: result?.detail || "jidelna" };
    return { ok: true };
  } catch (error) {
    if (error instanceof AppError && error.code === "login") return { ok: false, code: "jidelna" };
    return { ok: false, code: "spojeni" };
  }
}
