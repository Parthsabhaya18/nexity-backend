# Nexity Backend

Node.js + Express 5 + TypeScript REST API.

## Structure

```
src/
  server.ts                 Entry point (listen + graceful shutdown)
  app.ts                    Express app (security, CORS, logging, routes, errors)
  config/env.ts             Environment validation (zod)
  routes/index.ts           Mounts feature routers under API_PREFIX
  modules/<feature>/        Feature modules: *.routes.ts, *.controller.ts, *.service.ts
  middlewares/              Error + 404 handlers
  utils/                    Logger (pino), ApiError
tests/                      Vitest + Supertest
```

## Commands

```powershell
npm install
copy .env.example .env      # first time only
npm run dev                 # watch mode on http://localhost:4000/api/v1
npm test                    # run tests
npm run lint                # ESLint
npm run typecheck           # TypeScript
npm run build               # compile to dist/
npm start                   # run compiled build (set NODE_ENV=production in the environment)
```

Health check: `GET http://localhost:4000/api/v1/health`

## Reaching the API from the phone

- **USB (recommended):** `adb reverse tcp:4000 tcp:4000`. The app uses `http://localhost:4000`.
- **Wi-Fi:** the server listens on `0.0.0.0`; point `DEV_API_URL` in the app's `src/config/env.ts` to `http://<PC-LAN-IP>:4000/api/v1` and allow port 4000 in Windows Firewall.
