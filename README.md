# Switch Delivery

This repo is ready for Vercel:

- `index.html`: live customer storefront
- `admin.html`: admin dashboard for vendors, menus, delivery fees, slot controls, and recent orders
- `api/[...route].js`: Vercel serverless backend
- `api/_lib/*`: auth and storage helpers

## Vercel deployment

How it works:

- static HTML is served directly by Vercel
- backend runs from `api/[...route].js`
- persistent data should be stored in Vercel KV

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

After that:

- admin changes to vendors, menus, delivery fees, and slot states are stored centrally
- the live storefront polls for updates automatically
- orders older than 24 hours are hidden from the admin dashboard to reduce clutter

## Current default fees

- Dhanush: `65`
- Illara Hotels: `90`
- Aroma: `90`
