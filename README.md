# Cyara Copilot — Vercel (React + Serverless)

This project contains a React SPA (Vite) and Vercel Serverless API routes to:
- Verify a user-provided token against a server-side environment variable.
- Proxy chat requests to the Cyara API while hiding the upstream URL and credentials.

## Environment Variables (set in Vercel Dashboard)

- `API_TOKEN` — your shared secret token (used to verify users and to auth upstream if needed)
- `CYARA_API_URL` — the upstream endpoint to proxy to (e.g. https://7jfvvi4m0g.execute-api.us-east-1.amazonaws.com/api/dev/external)

## Local Development

```bash
# 1) Install deps
npm install

# 2) Run locally with Vercel (recommended)
npm run vercel-dev
# (requires `npm i -g vercel` and `vercel login`)

# Alternative: run frontend only (serverless functions won't run)
npm run dev
```

When using `vercel dev`, API routes are served at `http://localhost:3000/api/*` and Vite proxies `/api` to that port via `vite.config.js`.

## Deploy on Vercel

1. Push this folder to a Git repo and import it in Vercel.
2. In **Settings → Environment Variables**, add:
   - `API_TOKEN=...`
   - `CYARA_API_URL=...`
3. Deploy.

## Security Notes

- The token is never stored in the browser. It is only held in memory and verified server-side on every request.
- The client never sees the upstream API URL; it calls `/api/chat` instead.
- Do **not** commit real tokens to Git.
