const DEFAULT_VENDORS = [
  { id: "dhanush", name: "Dhanush", emoji: "🛒", fee: 65 },
  { id: "illara", name: "Illara Hotels", emoji: "🍽️", fee: 90 },
  { id: "aroma", name: "Aroma", emoji: "🌿", fee: 90 },
];

const KEYS = {
  vendors: "switch:vendors",
  menus: "switch:menus",
  orders: "switch:orders",
};

const memory = {
  vendors: [...DEFAULT_VENDORS],
  menus: {},
  orders: [],
};

function hasKv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvCommand(command) {
  const res = await fetch(process.env.KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    throw new Error(`KV request failed with ${res.status}`);
  }
  return res.json();
}

async function loadJson(key, fallback) {
  if (!hasKv()) return structuredClone(fallback);
  const data = await kvCommand(["GET", key]);
  if (data.result === null || data.result === undefined) return structuredClone(fallback);
  if (typeof data.result === "string") {
    try {
      return JSON.parse(data.result);
    } catch {
      return structuredClone(fallback);
    }
  }
  return data.result;
}

async function saveJson(key, value) {
  if (!hasKv()) {
    return value;
  }
  await kvCommand(["SET", key, JSON.stringify(value)]);
  return value;
}

async function ensureSeeded() {
  if (hasKv()) {
    const vendors = await loadJson(KEYS.vendors, DEFAULT_VENDORS);
    const menus = await loadJson(KEYS.menus, {});
    const orders = await loadJson(KEYS.orders, []);
    if (!Array.isArray(vendors) || vendors.length === 0) {
      await saveJson(KEYS.vendors, DEFAULT_VENDORS);
    }
    if (!menus || typeof menus !== "object" || Array.isArray(menus)) {
      await saveJson(KEYS.menus, {});
    }
    if (!Array.isArray(orders)) {
      await saveJson(KEYS.orders, []);
    }
    return;
  }
  if (!memory.vendors.length) memory.vendors = [...DEFAULT_VENDORS];
}

async function getVendors() {
  await ensureSeeded();
  if (!hasKv()) return structuredClone(memory.vendors);
  return loadJson(KEYS.vendors, DEFAULT_VENDORS);
}

async function saveVendors(vendors) {
  if (!hasKv()) {
    memory.vendors = structuredClone(vendors);
    return memory.vendors;
  }
  return saveJson(KEYS.vendors, vendors);
}

async function getMenus() {
  await ensureSeeded();
  if (!hasKv()) return structuredClone(memory.menus);
  return loadJson(KEYS.menus, {});
}

async function saveMenus(menus) {
  if (!hasKv()) {
    memory.menus = structuredClone(menus);
    return memory.menus;
  }
  return saveJson(KEYS.menus, menus);
}

async function getOrders() {
  await ensureSeeded();
  if (!hasKv()) return structuredClone(memory.orders);
  return loadJson(KEYS.orders, []);
}

async function saveOrders(orders) {
  if (!hasKv()) {
    memory.orders = structuredClone(orders);
    return memory.orders;
  }
  return saveJson(KEYS.orders, orders);
}

module.exports = {
  DEFAULT_VENDORS,
  getMenus,
  getOrders,
  getVendors,
  hasKv,
  saveMenus,
  saveOrders,
  saveVendors,
};
