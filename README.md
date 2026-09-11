# EA Designer

A visual designer for mapping enterprise systems and the data flowing between them. Add systems (ArchiMate-styled application components), define data objects with a master system and per-system aliases, and draw integrations between systems - the canvas auto-declutters multi-system fan-in/fan-out into junction nodes and flags data objects with more than one apparent master in red.

## Stack

- **Frontend**: React 19 + TypeScript + Vite, using [`@xyflow/react`](https://reactflow.dev/) for the canvas and Tailwind CSS v4 for styling.
- **Backend**: Express + `pg`, exposing a simple `GET/POST /api/state` full-state sync endpoint.
- **Database**: PostgreSQL 15, auto-migrated on backend startup.

## Running with Docker

The whole stack (frontend, backend, Postgres) is defined in `docker-compose.yml`. Port numbers are read from `config.env`:

```bash
docker compose --env-file config.env up -d --build
```

- Frontend: http://localhost:80 (or `APP_FRONTEND_PORT` from `config.env`)
- Backend API: http://localhost:4001/api/state (or `APP_BACKEND_PORT`)
- Postgres: localhost:5432 (or `APP_DB_PORT`)

To change a port, edit `config.env` before running the command above (the frontend bakes `APP_BACKEND_PORT` into its build, so a port change needs a rebuild - `--build` handles that). You can also override ports directly on the command line:

```bash
APP_FRONTEND_PORT=8080 APP_BACKEND_PORT=5000 docker compose up -d
```

The app stores state in the Postgres volume (`pgdata`), so data survives `docker compose down` / `up` cycles; use `docker compose down -v` to also wipe the database.

## Local development (frontend only)

```bash
npm install
npm run dev      # Vite dev server with HMR
npm run build    # type-check (tsc -b) + production build
npm run lint      # ESLint
```

The frontend expects a backend reachable at `http://<the host it was loaded from>:<VITE_BACKEND_PORT>` (default `4001`); run the backend separately (`cd server && npm install && node index.js`) with a Postgres instance available, or just use Docker Compose for the full stack.
