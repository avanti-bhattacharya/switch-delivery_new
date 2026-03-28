# Switch Delivery

This project now supports two backend modes:

- `server.py`: local Python server with SQLite
- `api/[...route].js`: Vercel serverless backend

The frontend stays the same:

- `index.html`: live customer storefront
- `admin.html`: admin dashboard for vendors, menus, delivery fees, and orders

## Local run

```bash
python3 server.py
```

Then open:

- `http://localhost:8000/`
- `http://localhost:8000/admin.html`

## Vercel deployment

This repo is now set up for Vercel:

- static HTML is served directly
- backend runs from `api/[...route].js`
- data should be stored in Vercel KV

### Required Vercel environment variables

```bash
SWITCH_ADMIN_PASSWORD=your-admin-password
SWITCH_AUTH_SECRET=long-random-secret
SWITCH_UPI_ID=your-upi-id
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

### Important note

Without `KV_REST_API_URL` and `KV_REST_API_TOKEN`, the Vercel API falls back to temporary in-memory storage. That is only useful for quick previews and will not persist changes between serverless invocations.

### Recommended Vercel setup

1. Import the project into Vercel.
2. Create and attach a Vercel KV database.
3. Add the environment variables above.
4. Redeploy.

After that, admin changes to vendors, menus, and delivery fees are stored centrally and the live storefront polls for updates automatically.

## Current default fees

- Dhanush: `65`
- Illara Hotels: `90`
- Aroma: `90`
