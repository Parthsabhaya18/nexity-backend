# Nexity Backend

Node.js + Express 5 + TypeScript REST API.

## Structure

```
src/
  server.ts                 Entry point (listen + graceful shutdown)
  app.ts                    Express app (security, CORS, logging, routes, errors)
  config/env.ts             Environment validation (zod)
  config/database.ts        MongoDB connection (Mongoose): connect with retry, disconnect, status
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

Health check: `GET http://localhost:4000/api/v1/health` (liveness, includes `database` status)
Readiness: `GET http://localhost:4000/api/v1/health/ready` (`503` until MongoDB is connected)

MongoDB write/read test (disabled when `NODE_ENV=production`), stored in the `health_checks` collection:

```powershell
# Insert a document and read it back (body is optional)
Invoke-RestMethod -Method Post http://localhost:4000/api/v1/health/db-test -ContentType 'application/json' -Body '{"message":"hello mongo"}'
# List the latest 20 documents and the total count
Invoke-RestMethod http://localhost:4000/api/v1/health/db-test
# Delete all test documents
Invoke-RestMethod -Method Delete http://localhost:4000/api/v1/health/db-test
```

## MongoDB

The server connects to MongoDB before it starts listening and exits with a clear error if it cannot (3 attempts, 3 s apart). Tests use an in-memory MongoDB, so they need no database.

### Development (local MongoDB on Windows)

1. Install [MongoDB Community Server](https://www.mongodb.com/try/download/community) (MSI, "Install MongoD as a Service" checked) and optionally [MongoDB Compass](https://www.mongodb.com/try/download/compass).
2. Check it is running: `Get-Service MongoDB` should show `Running` (start it with `Start-Service MongoDB`).
3. In `.env`:
   ```
   MONGODB_URI=mongodb://127.0.0.1:27017
   MONGODB_DB_NAME=nexity_dev
   ```
4. `npm run dev` — the log shows `MongoDB connected` with `db: "nexity_dev"`.

Use `127.0.0.1`, not `localhost`: Node may resolve `localhost` to IPv6 `::1`, where `mongod` does not listen by default.

Instead of a local install you can point development at a free Atlas cluster (same steps as production, with `MONGODB_DB_NAME=nexity_dev`).

### Production (MongoDB Atlas)

1. Create a cluster at [cloud.mongodb.com](https://cloud.mongodb.com), in a region close to the API server.
2. **Database Access** → add a database user (password auth, role *Read and write to any database*, or scoped to the `nexity` database).
3. **Network Access** → add the API server's outbound IP. Use `0.0.0.0/0` only if the host has no static IP (strong password required).
4. **Connect → Drivers** → copy the `mongodb+srv://` string. URL-encode special characters in the password (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`).
5. Set these in the hosting provider's environment variables (never commit them):
   ```
   NODE_ENV=production
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
   MONGODB_DB_NAME=nexity
   ```
6. `npm ci && npm run build && npm start`, then confirm `GET /api/v1/health/ready` returns `200`. Point the platform's health check at `/api/v1/health/ready`.

### Troubleshooting

| Error in the log | Fix |
|------------------|-----|
| `MONGODB_URI is required` | Add `MONGODB_URI` to `.env` / host environment |
| `ECONNREFUSED 127.0.0.1:27017` | Local MongoDB service is not running — `Start-Service MongoDB` |
| `bad auth` / `Authentication failed` | Wrong Atlas user or password, or password not URL-encoded |
| `Server selection timed out` / `querySrv` | IP not in Atlas Network Access, or DNS/firewall blocking — check the allowlist |

## Reaching the API from the phone

- **USB (recommended):** `adb reverse tcp:4000 tcp:4000`. The app uses `http://localhost:4000`.
- **Wi-Fi:** the server listens on `0.0.0.0`; point `DEV_API_URL` in the app's `src/config/env.ts` to `http://<PC-LAN-IP>:4000/api/v1` and allow port 4000 in Windows Firewall.
