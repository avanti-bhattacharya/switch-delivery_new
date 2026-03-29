const { issueAdminToken, verifyToken } = require("./_lib/auth");
const { getMenus, getOrders, getSiteConfig, getVendors, hasKv, saveMenus, saveOrders, saveSiteConfig, saveVendors } = require("./_lib/store");

const UPI_ID = process.env.SWITCH_UPI_ID || "avanti102006@okhdfcbank";
const ADMIN_PASSWORD = process.env.SWITCH_ADMIN_PASSWORD || "switchdel1975";

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.end(JSON.stringify(payload));
}

function sendText(res, status, contentType, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.end(body);
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function getToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  if (req.query && req.query.token) return String(req.query.token);
  return "";
}

function requireAdmin(req, res) {
  const token = getToken(req);
  const payload = verifyToken(token);
  if (!payload || payload.role !== "admin") {
    sendJson(res, 401, { error: "Admin auth required." });
    return false;
  }
  return true;
}

function routeParts(req) {
  try {
    const url = new URL(req.url, "http://localhost");
    return url.pathname
      .replace(/^\/api\/?/, "")
      .split("/")
      .filter(Boolean);
  } catch {
    const raw = req.query && req.query.route;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }
}

function normalizeVendor(vendor) {
  return {
    id: String(vendor.id || "").trim().toLowerCase(),
    name: String(vendor.name || "").trim(),
    emoji: String(vendor.emoji || "🍽️").trim() || "🍽️",
    fee: Number(vendor.fee || 0) || 0,
  };
}

function parseNumericId(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function vendorNameMap(vendors) {
  return new Map(vendors.map((vendor) => [vendor.id, vendor.name]));
}

function nextMenuItemId(menus) {
  const ids = Object.values(menus)
    .flat()
    .map((item) => Number(item.id) || 0);
  return (Math.max(0, ...ids) || 0) + 1;
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function recentOrders(orders) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return orders.filter((order) => {
    const time = Date.parse(order.timestamp || "");
    return Number.isFinite(time) && time >= cutoff;
  });
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  try {
    const parts = routeParts(req);
    const path = `/${parts.join("/")}`;

    if (req.method === "GET" && path === "/health") {
      return sendJson(res, 200, { ok: true, runtime: "vercel", kvConfigured: hasKv() });
    }

    if (req.method === "GET" && path === "/site-config") {
      const siteConfig = await getSiteConfig();
      return sendJson(res, 200, {
        upiId: UPI_ID,
        realtime: true,
        storage: hasKv() ? "vercel-kv" : "memory",
        slots: siteConfig.slots,
      });
    }

    if (req.method === "GET" && path === "/vendors") {
      return sendJson(res, 200, { vendors: await getVendors() });
    }

    if (req.method === "GET" && path === "/menus") {
      return sendJson(res, 200, { menus: await getMenus() });
    }

    if (req.method === "GET" && parts[0] === "menus" && parts[1]) {
      const menus = await getMenus();
      return sendJson(res, 200, { items: menus[parts[1]] || [] });
    }

    if (req.method === "POST" && path === "/orders") {
      const payload = await readBody(req);
      const required = ["id", "name", "room", "phone", "slot", "payment", "subtotal", "deliveryFee", "total", "timestamp"];
      if (!Array.isArray(payload.items) || payload.items.length === 0 || required.some((key) => payload[key] === undefined || payload[key] === "")) {
        return sendJson(res, 400, { error: "Missing required order fields." });
      }
      const orders = await getOrders();
      if (orders.some((order) => order.id === payload.id)) {
        return sendJson(res, 409, { error: "Order ID already exists." });
      }
      orders.unshift({
        id: payload.id,
        name: payload.name,
        room: payload.room,
        phone: payload.phone,
        slot: payload.slot,
        notes: payload.notes || "",
        payment: payload.payment,
        items: payload.items,
        subtotal: Number(payload.subtotal) || 0,
        deliveryFee: Number(payload.deliveryFee) || 0,
        deliveryBreakdown: payload.deliveryBreakdown || "",
        total: Number(payload.total) || 0,
        timestamp: payload.timestamp,
        status: "pending",
      });
      await saveOrders(orders);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && path === "/admin/login") {
      const payload = await readBody(req);
      if ((payload.password || "") !== ADMIN_PASSWORD) {
        return sendJson(res, 401, { error: "Incorrect password." });
      }
      return sendJson(res, 200, { token: issueAdminToken() });
    }

    if (!path.startsWith("/admin")) {
      return sendJson(res, 404, { error: "Not found." });
    }

    if (!requireAdmin(req, res)) return;

    if (req.method === "GET" && path === "/admin/bootstrap") {
      const siteConfig = await getSiteConfig();
      return sendJson(res, 200, {
        vendors: await getVendors(),
        menus: await getMenus(),
        orders: recentOrders(await getOrders()),
        siteConfig: { upiId: UPI_ID, storage: hasKv() ? "vercel-kv" : "memory", slots: siteConfig.slots },
      });
    }

    if (req.method === "PATCH" && path === "/admin/site-config") {
      const payload = await readBody(req);
      const current = await getSiteConfig();
      const next = {
        ...current,
        slots: {
          ...current.slots,
          ...((payload && payload.slots) || {}),
        },
      };
      const valid = ["auto", "open", "closed"];
      if (!valid.includes(next.slots.morning) || !valid.includes(next.slots.afternoon)) {
        return sendJson(res, 400, { error: "Invalid slot state." });
      }
      await saveSiteConfig(next);
      return sendJson(res, 200, {
        siteConfig: { upiId: UPI_ID, storage: hasKv() ? "vercel-kv" : "memory", slots: next.slots },
      });
    }

    if (req.method === "POST" && path === "/admin/vendors") {
      const payload = normalizeVendor(await readBody(req));
      if (!payload.id || !payload.name) {
        return sendJson(res, 400, { error: "Vendor ID and name are required." });
      }
      const vendors = await getVendors();
      if (vendors.some((vendor) => vendor.id === payload.id)) {
        return sendJson(res, 409, { error: "Vendor ID already exists." });
      }
      vendors.push(payload);
      await saveVendors(vendors);
      return sendJson(res, 201, { vendors });
    }

    if (parts[0] === "admin" && parts[1] === "vendors" && parts[2]) {
      const vendorId = parts[2];
      if (req.method === "PUT") {
        const payload = normalizeVendor(await readBody(req));
        if (!payload.name) {
          return sendJson(res, 400, { error: "Vendor name is required." });
        }
        const vendors = await getVendors();
        const vendor = vendors.find((entry) => entry.id === vendorId);
        if (!vendor) {
          return sendJson(res, 404, { error: "Vendor not found." });
        }
        vendor.name = payload.name;
        vendor.emoji = payload.emoji;
        vendor.fee = payload.fee;
        await saveVendors(vendors);

        const orders = await getOrders();
        orders.forEach((order) => {
          order.items = (order.items || []).map((item) =>
            item.vendorId === vendorId ? { ...item, vendor: payload.name } : item
          );
        });
        await saveOrders(orders);
        return sendJson(res, 200, { vendors });
      }

      if (req.method === "DELETE") {
        const vendors = await getVendors();
        if (vendors.length <= 1) {
          return sendJson(res, 400, { error: "At least one vendor is required." });
        }
        const nextVendors = vendors.filter((vendor) => vendor.id !== vendorId);
        if (nextVendors.length === vendors.length) {
          return sendJson(res, 404, { error: "Vendor not found." });
        }
        await saveVendors(nextVendors);
        const menus = await getMenus();
        delete menus[vendorId];
        await saveMenus(menus);
        return sendJson(res, 200, { vendors: nextVendors });
      }
    }

    if (parts[0] === "admin" && parts[1] === "menus" && parts[2] && parts[3] === "bulk" && req.method === "POST") {
      const vendorId = parts[2];
      const payload = await readBody(req);
      const vendors = await getVendors();
      if (!vendors.some((vendor) => vendor.id === vendorId)) {
        return sendJson(res, 404, { error: "Vendor not found." });
      }
      const menus = await getMenus();
      let idCounter = nextMenuItemId(menus);
      menus[vendorId] = (Array.isArray(payload.items) ? payload.items : [])
        .filter((item) => String(item.name || "").trim() && Number(item.price) > 0)
        .map((item, index) => ({
          id: idCounter++,
          vendorId,
          name: String(item.name).trim(),
          price: Number(item.price),
          category: String(item.category || "").trim(),
          emoji: String(item.emoji || "🍽️").trim() || "🍽️",
          sortOrder: index + 1,
        }));
      await saveMenus(menus);
      return sendJson(res, 200, { items: menus[vendorId] });
    }

    if (req.method === "POST" && path === "/admin/menu-items") {
      const payload = await readBody(req);
      const vendorId = String(payload.vendorId || "");
      const vendors = await getVendors();
      if (!vendors.some((vendor) => vendor.id === vendorId)) {
        return sendJson(res, 404, { error: "Vendor not found." });
      }
      if (!String(payload.name || "").trim() || Number(payload.price) <= 0) {
        return sendJson(res, 400, { error: "Vendor, item name, and valid price are required." });
      }
      const menus = await getMenus();
      const nextId = nextMenuItemId(menus);
      const item = {
        id: nextId,
        vendorId,
        name: String(payload.name).trim(),
        price: Number(payload.price),
        category: String(payload.category || "").trim(),
        emoji: String(payload.emoji || "🍽️").trim() || "🍽️",
        sortOrder: (menus[vendorId] || []).length + 1,
      };
      menus[vendorId] = [...(menus[vendorId] || []), item];
      await saveMenus(menus);
      return sendJson(res, 201, { item });
    }

    if (parts[0] === "admin" && parts[1] === "menu-items" && parts[2]) {
      const itemId = parseNumericId(parts[2]);
      if (itemId === null) {
        return sendJson(res, 400, { error: "Invalid menu item ID." });
      }
      const menus = await getMenus();
      const vendorId = Object.keys(menus).find((key) => (menus[key] || []).some((item) => Number(item.id) === itemId));
      if (!vendorId) {
        return sendJson(res, 404, { error: "Menu item not found." });
      }

      if (req.method === "PUT") {
        const payload = await readBody(req);
        if (!String(payload.name || "").trim() || Number(payload.price) <= 0) {
          return sendJson(res, 400, { error: "Item name and valid price are required." });
        }
        let updated = null;
        menus[vendorId] = menus[vendorId].map((item) => {
          if (Number(item.id) !== itemId) return item;
          updated = {
            ...item,
            name: String(payload.name).trim(),
            price: Number(payload.price),
            category: String(payload.category || "").trim(),
            emoji: String(payload.emoji || "🍽️").trim() || "🍽️",
          };
          return updated;
        });
        await saveMenus(menus);
        return sendJson(res, 200, { item: updated });
      }

      if (req.method === "DELETE") {
        menus[vendorId] = menus[vendorId].filter((item) => Number(item.id) !== itemId);
        await saveMenus(menus);
        return sendJson(res, 200, { ok: true });
      }
    }

    if (req.method === "GET" && path === "/admin/orders") {
      return sendJson(res, 200, { orders: recentOrders(await getOrders()) });
    }

    if (parts[0] === "admin" && parts[1] === "orders" && parts[2] && parts[3] === "status" && req.method === "PATCH") {
      const payload = await readBody(req);
      const status = String(payload.status || "").toLowerCase();
      if (!["pending", "done", "cancel"].includes(status)) {
        return sendJson(res, 400, { error: "Invalid status." });
      }
      const orders = await getOrders();
      const order = orders.find((entry) => entry.id === parts[2]);
      if (!order) {
        return sendJson(res, 404, { error: "Order not found." });
      }
      order.status = status;
      await saveOrders(orders);
      return sendJson(res, 200, { orders });
    }

    if (req.method === "GET" && path === "/admin/export/orders") {
      const vendors = await getVendors();
      const nameByVendor = vendorNameMap(vendors);
      const orders = await getOrders();
      const rows = [
        ["Order ID", "Name", "Room", "Phone", "Slot", "Items", "Subtotal", "Delivery", "Total", "Payment", "Status", "Notes", "Time"],
        ...orders.map((order) => [
          order.id,
          order.name,
          order.room,
          order.phone,
          order.slot,
          (order.items || [])
            .map((item) => `${item.qty}x ${item.name} (${item.vendor || nameByVendor.get(item.vendorId) || item.vendorId || ""})`)
            .join("; "),
          order.subtotal,
          order.deliveryFee,
          order.total,
          order.payment,
          order.status || "pending",
          order.notes || "",
          order.timestamp,
        ]),
      ];
      const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
      return sendText(res, 200, "text/csv; charset=utf-8", csv, {
        "Content-Disposition": `attachment; filename="switch-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
      });
    }

    if (req.method === "DELETE" && path === "/admin/orders") {
      await saveOrders([]);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && path === "/admin/menus") {
      await saveMenus({});
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    return sendJson(res, 500, {
      error: error && error.message ? error.message : "Internal server error.",
    });
  }
};
