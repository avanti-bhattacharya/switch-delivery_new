const DEFAULT_VENDORS = [
  { id: "dhanush", name: "Dhanush", emoji: "🛒", fee: 65 },
  { id: "illara", name: "Illara Hotels", emoji: "🍽️", fee: 90 },
  { id: "aroma", name: "Aroma", emoji: "🌿", fee: 90 },
];

const KEYS = {
  vendors: "switch:vendors",
  menus: "switch:menus",
  orders: "switch:orders",
  siteConfig: "switch:site-config",
};

const memory = {
  vendors: [...DEFAULT_VENDORS],
  menus: {},
  orders: [],
  siteConfig: {
    slots: {
      morning: "auto",
      afternoon: "auto",
    },
  },
};

function hasKv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function kvUrl(command, key, value) {
  const base = process.env.KV_REST_API_URL || "";
  if (command === "GET") return `${base}/get/${encodeURIComponent(key)}`;
  if (command === "SET") return `${base}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`;
  throw new Error(`Unsupported KV command: ${command}`);
}

async function kvCommand(command, key, value = "") {
  const res = await fetch(kvUrl(command, key, value), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
    },
  });
  if (!res.ok) {
    throw new Error(`KV request failed with ${res.status}`);
  }
  return res.json();
}

async function loadJson(key, fallback) {
  if (!hasKv()) return structuredClone(fallback);
  try {
    const data = await kvCommand("GET", key);
    if (data.result === null || data.result === undefined) return structuredClone(fallback);
    if (typeof data.result === "string") {
      try {
        return JSON.parse(data.result);
      } catch {
        return structuredClone(fallback);
      }
    }
    return data.result;
  } catch {
    return structuredClone(fallback);
  }
}

async function saveJson(key, value) {
  if (!hasKv()) {
    return value;
  }
  try {
    await kvCommand("SET", key, JSON.stringify(value));
    return value;
  } catch {
    // Fall back to non-persistent behavior instead of taking the whole site down.
    return value;
  }
}

async function ensureSeeded() {
  if (hasKv()) {
    let vendors = await loadJson(KEYS.vendors, DEFAULT_VENDORS);
    let menus = await loadJson(KEYS.menus, {});
    let orders = await loadJson(KEYS.orders, []);
    let siteConfig = await loadJson(KEYS.siteConfig, memory.siteConfig);
    if (!Array.isArray(vendors) || vendors.length === 0) {
      await saveJson(KEYS.vendors, DEFAULT_VENDORS);
      vendors = DEFAULT_VENDORS;
    }
    if (!menus || typeof menus !== "object" || Array.isArray(menus)) {
      await saveJson(KEYS.menus, {});
      menus = {};
    }
    if (!Array.isArray(orders)) {
      await saveJson(KEYS.orders, []);
      orders = [];
    }
    if (!siteConfig || typeof siteConfig !== "object" || Array.isArray(siteConfig)) {
      await saveJson(KEYS.siteConfig, memory.siteConfig);
      siteConfig = memory.siteConfig;
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

async function getSiteConfig() {
  await ensureSeeded();
  if (!hasKv()) return structuredClone(memory.siteConfig);
  const config = await loadJson(KEYS.siteConfig, memory.siteConfig);
  return {
    ...memory.siteConfig,
    ...config,
    slots: {
      ...memory.siteConfig.slots,
      ...(config.slots || {}),
    },
  };
}

async function saveSiteConfig(siteConfig) {
  const normalized = {
    ...memory.siteConfig,
    ...siteConfig,
    slots: {
      ...memory.siteConfig.slots,
      ...((siteConfig && siteConfig.slots) || {}),
    },
  };
  if (!hasKv()) {
    memory.siteConfig = structuredClone(normalized);
    return memory.siteConfig;
  }
  return saveJson(KEYS.siteConfig, normalized);
}

module.exports = {
  DEFAULT_VENDORS,
  getMenus,
  getOrders,
  getSiteConfig,
  getVendors,
  hasKv,
  saveMenus,
  saveOrders,
  saveSiteConfig,
  saveVendors,
};
