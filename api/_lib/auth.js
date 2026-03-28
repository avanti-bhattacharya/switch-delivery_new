const { createHmac, timingSafeEqual } = require("crypto");

function getAuthSecret() {
  return process.env.SWITCH_AUTH_SECRET || process.env.SWITCH_ADMIN_PASSWORD || "switch-auth-secret";
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function sign(value) {
  return createHmac("sha256", getAuthSecret()).update(value).digest("base64url");
}

function createToken(payload) {
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, signature] = token.split(".", 2);
  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(body));
    if (!payload || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function issueAdminToken() {
  return createToken({
    role: "admin",
    exp: Date.now() + 12 * 60 * 60 * 1000,
  });
}

module.exports = {
  issueAdminToken,
  verifyToken,
};
