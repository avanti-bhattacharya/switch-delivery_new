# Switch Delivery Backend

This project now runs as a small full-stack app:

- `index.html`: live customer storefront
- `admin.html`: admin dashboard for vendors, menus, and orders
- `server.py`: Python backend that serves the site and stores shared data in SQLite

## Run locally

```bash
python3 server.py
```

Then open:

- `http://localhost:8000/`
- `http://localhost:8000/admin.html`

## Shared database

The backend stores data in:

- `data/switch.db`

That means vendor changes, menu uploads, and customer orders are saved centrally instead of inside one browser's `localStorage`.

## Optional environment variables

```bash
SWITCH_ADMIN_PASSWORD=your-password
SWITCH_UPI_ID=your-upi-id
SWITCH_PORT=8000
```

## Deploy

Deploy the whole folder on any host that can run Python 3, then start:

```bash
python3 server.py
```

Examples: Render, Railway, Fly.io, a VPS, or any Python-capable hosting platform.
