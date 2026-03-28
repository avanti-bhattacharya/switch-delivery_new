#!/usr/bin/env python3
import csv
import io
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


ROOT = Path(__file__).resolve().parent
DB_DIR = ROOT / "data"
DB_PATH = DB_DIR / "switch.db"
ADMIN_PASSWORD = os.environ.get("SWITCH_ADMIN_PASSWORD", "switchdel1975")
UPI_ID = os.environ.get("SWITCH_UPI_ID", "avanti102006@okhdfcbank")
HOST = os.environ.get("SWITCH_HOST", "0.0.0.0")
PORT = int(os.environ.get("SWITCH_PORT", "8000"))
TOKEN_TTL_HOURS = 12
STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/admin.html": "admin.html",
}
DEFAULT_VENDORS = [
    {"id": "dhanush", "name": "Dhanush", "emoji": "🛒", "fee": 65},
    {"id": "illara", "name": "Illara Hotels", "emoji": "🍽️", "fee": 90},
    {"id": "aroma", "name": "Aroma", "emoji": "🌿", "fee": 90},
]
TOKENS = {}


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DB_DIR.mkdir(exist_ok=True)
    with db() as conn:
        conn.executescript(
            """
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS vendors (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              emoji TEXT NOT NULL DEFAULT '🍽️',
              fee INTEGER NOT NULL DEFAULT 100,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS menu_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              vendor_id TEXT NOT NULL,
              name TEXT NOT NULL,
              price INTEGER NOT NULL,
              category TEXT NOT NULL DEFAULT '',
              emoji TEXT NOT NULL DEFAULT '🍽️',
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS orders (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              room TEXT NOT NULL,
              phone TEXT NOT NULL,
              slot TEXT NOT NULL,
              notes TEXT NOT NULL DEFAULT '',
              payment TEXT NOT NULL,
              subtotal INTEGER NOT NULL,
              delivery_fee INTEGER NOT NULL,
              delivery_breakdown TEXT NOT NULL DEFAULT '',
              total INTEGER NOT NULL,
              timestamp TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'pending'
            );

            CREATE TABLE IF NOT EXISTS order_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              order_id TEXT NOT NULL,
              vendor_id TEXT NOT NULL,
              vendor_name TEXT NOT NULL,
              name TEXT NOT NULL,
              qty INTEGER NOT NULL,
              price INTEGER NOT NULL,
              FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
            );
            """
        )
        existing = conn.execute("SELECT COUNT(*) AS c FROM vendors").fetchone()["c"]
        if existing == 0:
            conn.executemany(
                "INSERT INTO vendors(id, name, emoji, fee) VALUES (?, ?, ?, ?)",
                [(v["id"], v["name"], v["emoji"], v["fee"]) for v in DEFAULT_VENDORS],
            )
        else:
            for vendor in DEFAULT_VENDORS:
                conn.execute(
                    """
                    UPDATE vendors
                    SET fee = CASE
                        WHEN id = 'dhanush' AND fee = 80 THEN 65
                        WHEN id IN ('illara', 'aroma') AND fee = 100 THEN 90
                        ELSE fee
                    END
                    WHERE id = ?
                    """,
                    (vendor["id"],),
                )


def now_utc():
    return datetime.now(timezone.utc)


def issue_token():
    token = secrets.token_urlsafe(32)
    TOKENS[token] = now_utc() + timedelta(hours=TOKEN_TTL_HOURS)
    return token


def cleanup_tokens():
    cutoff = now_utc()
    expired = [token for token, expires_at in TOKENS.items() if expires_at <= cutoff]
    for token in expired:
        TOKENS.pop(token, None)


def is_valid_token(token):
    cleanup_tokens()
    expires_at = TOKENS.get(token)
    return bool(expires_at and expires_at > now_utc())


def vendor_payload(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "emoji": row["emoji"],
        "fee": row["fee"],
    }


def menu_item_payload(row):
    return {
        "id": row["id"],
        "vendorId": row["vendor_id"],
        "name": row["name"],
        "price": row["price"],
        "category": row["category"],
        "emoji": row["emoji"],
        "sortOrder": row["sort_order"],
    }


def get_vendors(conn):
    rows = conn.execute("SELECT id, name, emoji, fee FROM vendors ORDER BY created_at, name").fetchall()
    return [vendor_payload(row) for row in rows]


def get_all_menus(conn):
    rows = conn.execute(
        """
        SELECT id, vendor_id, name, price, category, emoji, sort_order
        FROM menu_items
        ORDER BY vendor_id, sort_order, id
        """
    ).fetchall()
    menus = {}
    for row in rows:
        menus.setdefault(row["vendor_id"], []).append(menu_item_payload(row))
    return menus


def get_menu_for_vendor(conn, vendor_id):
    rows = conn.execute(
        """
        SELECT id, vendor_id, name, price, category, emoji, sort_order
        FROM menu_items
        WHERE vendor_id = ?
        ORDER BY sort_order, id
        """,
        (vendor_id,),
    ).fetchall()
    return [menu_item_payload(row) for row in rows]


def get_orders(conn):
    order_rows = conn.execute(
        """
        SELECT id, name, room, phone, slot, notes, payment, subtotal, delivery_fee,
               delivery_breakdown, total, timestamp, status
        FROM orders
        ORDER BY datetime(timestamp) DESC
        """
    ).fetchall()
    item_rows = conn.execute(
        """
        SELECT order_id, vendor_id, vendor_name, name, qty, price
        FROM order_items
        ORDER BY id ASC
        """
    ).fetchall()
    items_by_order = {}
    for row in item_rows:
        items_by_order.setdefault(row["order_id"], []).append(
            {
                "vendorId": row["vendor_id"],
                "vendor": row["vendor_name"],
                "name": row["name"],
                "qty": row["qty"],
                "price": row["price"],
            }
        )
    orders = []
    for row in order_rows:
        orders.append(
            {
                "id": row["id"],
                "name": row["name"],
                "room": row["room"],
                "phone": row["phone"],
                "slot": row["slot"],
                "notes": row["notes"],
                "payment": row["payment"],
                "subtotal": row["subtotal"],
                "deliveryFee": row["delivery_fee"],
                "deliveryBreakdown": row["delivery_breakdown"],
                "total": row["total"],
                "timestamp": row["timestamp"],
                "status": row["status"],
                "items": items_by_order.get(row["id"], []),
            }
        )
    return orders


class SwitchHandler(BaseHTTPRequestHandler):
    server_version = "SwitchHTTP/1.0"

    def log_message(self, format, *args):
        return

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            self.route_api("GET", path, parse_qs(parsed.query))
            return

        if path == "/favicon.ico":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return

        if path in STATIC_FILES:
            self.serve_file(ROOT / STATIC_FILES[path], "text/html; charset=utf-8")
            return

        candidate = (ROOT / path.lstrip("/")).resolve()
        if ROOT not in candidate.parents and candidate != ROOT:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if candidate.is_file():
            mime = "text/plain; charset=utf-8"
            if candidate.suffix == ".css":
                mime = "text/css; charset=utf-8"
            elif candidate.suffix == ".js":
                mime = "application/javascript; charset=utf-8"
            elif candidate.suffix == ".json":
                mime = "application/json; charset=utf-8"
            self.serve_file(candidate, mime)
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self):
        parsed = urlparse(self.path)
        self.route_api("POST", parsed.path, parse_qs(parsed.query))

    def do_PUT(self):
        parsed = urlparse(self.path)
        self.route_api("PUT", parsed.path, parse_qs(parsed.query))

    def do_PATCH(self):
        parsed = urlparse(self.path)
        self.route_api("PATCH", parsed.path, parse_qs(parsed.query))

    def do_DELETE(self):
        parsed = urlparse(self.path)
        self.route_api("DELETE", parsed.path, parse_qs(parsed.query))

    def serve_file(self, path, content_type):
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_csv(self, content, filename):
        body = content.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self._cors()
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON body."}, HTTPStatus.BAD_REQUEST)
            return None

    def require_auth(self, query=None):
        auth = self.headers.get("Authorization", "")
        token = ""
        if auth.startswith("Bearer "):
            token = auth.replace("Bearer ", "", 1).strip()
        elif query and query.get("token"):
            token = query["token"][0]
        if not token:
            self.send_json({"error": "Admin auth required."}, HTTPStatus.UNAUTHORIZED)
            return False
        if not is_valid_token(token):
            self.send_json({"error": "Session expired. Please log in again."}, HTTPStatus.UNAUTHORIZED)
            return False
        return True

    def route_api(self, method, path, query):
        if path == "/api/health" and method == "GET":
            self.send_json({"ok": True, "time": now_utc().isoformat()})
            return

        if path == "/api/site-config" and method == "GET":
            self.send_json({"upiId": UPI_ID})
            return

        if path == "/api/vendors" and method == "GET":
            with db() as conn:
                self.send_json({"vendors": get_vendors(conn)})
            return

        if path == "/api/menus" and method == "GET":
            with db() as conn:
                self.send_json({"menus": get_all_menus(conn)})
            return

        if path.startswith("/api/menus/") and method == "GET":
            vendor_id = unquote(path.split("/api/menus/", 1)[1])
            with db() as conn:
                self.send_json({"items": get_menu_for_vendor(conn, vendor_id)})
            return

        if path == "/api/orders" and method == "POST":
            payload = self.read_json()
            if payload is None:
                return
            items = payload.get("items", [])
            required = ["id", "name", "room", "phone", "slot", "payment", "subtotal", "deliveryFee", "total", "timestamp"]
            missing = [field for field in required if payload.get(field) in (None, "")]
            if missing or not items:
                self.send_json({"error": "Missing required order fields."}, HTTPStatus.BAD_REQUEST)
                return
            with db() as conn:
                try:
                    conn.execute(
                        """
                        INSERT INTO orders(
                          id, name, room, phone, slot, notes, payment, subtotal,
                          delivery_fee, delivery_breakdown, total, timestamp, status
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
                        """,
                        (
                            payload["id"],
                            payload["name"],
                            payload["room"],
                            payload["phone"],
                            payload["slot"],
                            payload.get("notes", ""),
                            payload["payment"],
                            int(payload["subtotal"]),
                            int(payload["deliveryFee"]),
                            payload.get("deliveryBreakdown", ""),
                            int(payload["total"]),
                            payload["timestamp"],
                        ),
                    )
                    conn.executemany(
                        """
                        INSERT INTO order_items(order_id, vendor_id, vendor_name, name, qty, price)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        [
                            (
                                payload["id"],
                                item.get("vendorId", ""),
                                item.get("vendor", ""),
                                item["name"],
                                int(item["qty"]),
                                int(item["price"]),
                            )
                            for item in items
                        ],
                    )
                except sqlite3.IntegrityError:
                    self.send_json({"error": "Order ID already exists."}, HTTPStatus.CONFLICT)
                    return
            self.send_json({"ok": True})
            return

        if path == "/api/admin/login" and method == "POST":
            payload = self.read_json()
            if payload is None:
                return
            if payload.get("password") != ADMIN_PASSWORD:
                self.send_json({"error": "Incorrect password."}, HTTPStatus.UNAUTHORIZED)
                return
            self.send_json({"token": issue_token()})
            return

        if not path.startswith("/api/admin/"):
            self.send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)
            return

        if not self.require_auth(query):
            return

        if path == "/api/admin/bootstrap" and method == "GET":
            with db() as conn:
                self.send_json(
                    {
                        "vendors": get_vendors(conn),
                        "menus": get_all_menus(conn),
                        "orders": get_orders(conn),
                        "siteConfig": {"upiId": UPI_ID},
                    }
                )
            return

        if path == "/api/admin/vendors" and method == "POST":
            payload = self.read_json()
            if payload is None:
                return
            vendor_id = (payload.get("id") or "").strip().lower()
            name = (payload.get("name") or "").strip()
            emoji = (payload.get("emoji") or "🍽️").strip()
            fee = int(payload.get("fee") or 100)
            if not vendor_id or not name:
                self.send_json({"error": "Vendor ID and name are required."}, HTTPStatus.BAD_REQUEST)
                return
            with db() as conn:
                try:
                    conn.execute(
                        "INSERT INTO vendors(id, name, emoji, fee) VALUES (?, ?, ?, ?)",
                        (vendor_id, name, emoji, fee),
                    )
                except sqlite3.IntegrityError:
                    self.send_json({"error": "Vendor ID already exists."}, HTTPStatus.CONFLICT)
                    return
                self.send_json({"vendors": get_vendors(conn)}, HTTPStatus.CREATED)
            return

        if path.startswith("/api/admin/vendors/"):
            vendor_id = unquote(path.split("/api/admin/vendors/", 1)[1])
            if method == "PUT":
                payload = self.read_json()
                if payload is None:
                    return
                name = (payload.get("name") or "").strip()
                emoji = (payload.get("emoji") or "🍽️").strip()
                fee = int(payload.get("fee") or 100)
                if not name:
                    self.send_json({"error": "Vendor name is required."}, HTTPStatus.BAD_REQUEST)
                    return
                with db() as conn:
                    cur = conn.execute(
                        "UPDATE vendors SET name = ?, emoji = ?, fee = ? WHERE id = ?",
                        (name, emoji, fee, vendor_id),
                    )
                    if cur.rowcount == 0:
                        self.send_json({"error": "Vendor not found."}, HTTPStatus.NOT_FOUND)
                        return
                    conn.execute(
                        "UPDATE order_items SET vendor_name = ? WHERE vendor_id = ?",
                        (name, vendor_id),
                    )
                    self.send_json({"vendors": get_vendors(conn)})
                return
            if method == "DELETE":
                with db() as conn:
                    count = conn.execute("SELECT COUNT(*) AS c FROM vendors").fetchone()["c"]
                    if count <= 1:
                        self.send_json({"error": "At least one vendor is required."}, HTTPStatus.BAD_REQUEST)
                        return
                    cur = conn.execute("DELETE FROM vendors WHERE id = ?", (vendor_id,))
                    if cur.rowcount == 0:
                        self.send_json({"error": "Vendor not found."}, HTTPStatus.NOT_FOUND)
                        return
                    self.send_json({"vendors": get_vendors(conn)})
                return

        if path.startswith("/api/admin/menus/") and path.endswith("/bulk") and method == "POST":
            vendor_id = unquote(path.split("/api/admin/menus/", 1)[1].rsplit("/bulk", 1)[0])
            payload = self.read_json()
            if payload is None:
                return
            items = payload.get("items", [])
            with db() as conn:
                exists = conn.execute("SELECT 1 FROM vendors WHERE id = ?", (vendor_id,)).fetchone()
                if not exists:
                    self.send_json({"error": "Vendor not found."}, HTTPStatus.NOT_FOUND)
                    return
                conn.execute("DELETE FROM menu_items WHERE vendor_id = ?", (vendor_id,))
                conn.executemany(
                    """
                    INSERT INTO menu_items(vendor_id, name, price, category, emoji, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            vendor_id,
                            (item.get("name") or "").strip(),
                            int(item.get("price") or 0),
                            (item.get("category") or "").strip(),
                            (item.get("emoji") or "🍽️").strip(),
                            idx,
                        )
                        for idx, item in enumerate(items, start=1)
                        if (item.get("name") or "").strip() and int(item.get("price") or 0) > 0
                    ],
                )
                self.send_json({"items": get_menu_for_vendor(conn, vendor_id)})
            return

        if path == "/api/admin/menu-items" and method == "POST":
            payload = self.read_json()
            if payload is None:
                return
            vendor_id = (payload.get("vendorId") or "").strip()
            name = (payload.get("name") or "").strip()
            price = int(payload.get("price") or 0)
            category = (payload.get("category") or "").strip()
            emoji = (payload.get("emoji") or "🍽️").strip()
            if not vendor_id or not name or price <= 0:
                self.send_json({"error": "Vendor, item name, and valid price are required."}, HTTPStatus.BAD_REQUEST)
                return
            with db() as conn:
                exists = conn.execute("SELECT 1 FROM vendors WHERE id = ?", (vendor_id,)).fetchone()
                if not exists:
                    self.send_json({"error": "Vendor not found."}, HTTPStatus.NOT_FOUND)
                    return
                sort_order = conn.execute(
                    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM menu_items WHERE vendor_id = ?",
                    (vendor_id,),
                ).fetchone()["next_order"]
                cur = conn.execute(
                    """
                    INSERT INTO menu_items(vendor_id, name, price, category, emoji, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (vendor_id, name, price, category, emoji, sort_order),
                )
                row = conn.execute(
                    """
                    SELECT id, vendor_id, name, price, category, emoji, sort_order
                    FROM menu_items WHERE id = ?
                    """,
                    (cur.lastrowid,),
                ).fetchone()
                self.send_json({"item": menu_item_payload(row)}, HTTPStatus.CREATED)
            return

        if path.startswith("/api/admin/menu-items/"):
            item_id = int(path.split("/api/admin/menu-items/", 1)[1])
            if method == "PUT":
                payload = self.read_json()
                if payload is None:
                    return
                name = (payload.get("name") or "").strip()
                price = int(payload.get("price") or 0)
                category = (payload.get("category") or "").strip()
                emoji = (payload.get("emoji") or "🍽️").strip()
                if not name or price <= 0:
                    self.send_json({"error": "Item name and valid price are required."}, HTTPStatus.BAD_REQUEST)
                    return
                with db() as conn:
                    cur = conn.execute(
                        """
                        UPDATE menu_items
                        SET name = ?, price = ?, category = ?, emoji = ?
                        WHERE id = ?
                        """,
                        (name, price, category, emoji, item_id),
                    )
                    if cur.rowcount == 0:
                        self.send_json({"error": "Menu item not found."}, HTTPStatus.NOT_FOUND)
                        return
                    row = conn.execute(
                        """
                        SELECT id, vendor_id, name, price, category, emoji, sort_order
                        FROM menu_items WHERE id = ?
                        """,
                        (item_id,),
                    ).fetchone()
                    self.send_json({"item": menu_item_payload(row)})
                return
            if method == "DELETE":
                with db() as conn:
                    cur = conn.execute("DELETE FROM menu_items WHERE id = ?", (item_id,))
                    if cur.rowcount == 0:
                        self.send_json({"error": "Menu item not found."}, HTTPStatus.NOT_FOUND)
                        return
                    self.send_json({"ok": True})
                return

        if path == "/api/admin/orders" and method == "GET":
            with db() as conn:
                self.send_json({"orders": get_orders(conn)})
            return

        if path.startswith("/api/admin/orders/") and path.endswith("/status") and method == "PATCH":
            order_id = unquote(path.split("/api/admin/orders/", 1)[1].rsplit("/status", 1)[0])
            payload = self.read_json()
            if payload is None:
                return
            status = (payload.get("status") or "").strip().lower()
            if status not in {"pending", "done", "cancel"}:
                self.send_json({"error": "Invalid status."}, HTTPStatus.BAD_REQUEST)
                return
            with db() as conn:
                cur = conn.execute("UPDATE orders SET status = ? WHERE id = ?", (status, order_id))
                if cur.rowcount == 0:
                    self.send_json({"error": "Order not found."}, HTTPStatus.NOT_FOUND)
                    return
                self.send_json({"orders": get_orders(conn)})
            return

        if path == "/api/admin/export/orders" and method == "GET":
            with db() as conn:
                orders = get_orders(conn)
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["Order ID", "Name", "Room", "Phone", "Slot", "Items", "Subtotal", "Delivery", "Total", "Payment", "Status", "Notes", "Time"])
            for order in orders:
                writer.writerow(
                    [
                        order["id"],
                        order["name"],
                        order["room"],
                        order["phone"],
                        order["slot"],
                        "; ".join(f'{item["qty"]}x {item["name"]} ({item["vendor"]})' for item in order["items"]),
                        order["subtotal"],
                        order["deliveryFee"],
                        order["total"],
                        order["payment"],
                        order["status"],
                        order["notes"],
                        order["timestamp"],
                    ]
                )
            filename = f"switch-orders-{datetime.now().date().isoformat()}.csv"
            self.send_csv(output.getvalue(), filename)
            return

        if path == "/api/admin/orders" and method == "DELETE":
            with db() as conn:
                conn.execute("DELETE FROM order_items")
                conn.execute("DELETE FROM orders")
            self.send_json({"ok": True})
            return

        if path == "/api/admin/menus" and method == "DELETE":
            with db() as conn:
                conn.execute("DELETE FROM menu_items")
            self.send_json({"ok": True})
            return

        self.send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)


if __name__ == "__main__":
    init_db()
    print(f"Switch server running on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), SwitchHandler).serve_forever()
