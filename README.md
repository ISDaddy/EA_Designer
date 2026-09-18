# EA Designer

> **Confidential - Proof of Concept.** This repository and the application it builds are proprietary and provided
> solely for evaluation. Anyone with access must accept the in-app NDA (`server/nda.js`) before using the app, and
> may not copy, reuse, or build on this code or design independently of that agreement. See `server/nda.js` for the
> full terms - it is a starting template, not vetted legal advice, and should be reviewed by a lawyer before this
> is relied on to actually protect the project.

A visual designer for mapping enterprise systems and the data flowing between them. Add systems (ArchiMate-styled application components) with ownership/lifecycle/criticality metadata, define data objects with a master system and, per system, the name and object id that system knows the object by, and draw integrations between systems - the canvas auto-declutters multi-system fan-in/fan-out into junction nodes and flags data objects with more than one apparent master in red.

Two views over the same landscape:
- **Canvas** - the visual node-and-edge diagram, with a focus mode (click a system) that declutters its connections.
- **Inventory** - a searchable, filterable, paginated table of every system (by status, criticality, owner, business capability), for browsing a landscape too large to usefully render as one diagram.

## Stack

- **Frontend**: React 19 + TypeScript + Vite, using [`@xyflow/react`](https://reactflow.dev/) for the canvas and Tailwind CSS v4 for styling.
- **Backend**: Express + `pg`, exposing a granular REST API (`/api/systems`, `/api/data-objects`, `/api/edges`, each with GET/POST/PATCH/DELETE, plus an aggregate `GET /api/state` for hydrating the canvas). Every edit persists as its own request rather than resyncing the whole graph, so the app stays responsive as a landscape grows into the hundreds or thousands of systems.
- **Database**: PostgreSQL 15, auto-migrated on backend startup, with indexes on the columns filters and joins depend on.

## Running with Docker

The whole stack (frontend, backend, Postgres) is defined in `docker-compose.yml`. Port numbers are read from `config.env`:

```bash
docker compose --env-file config.env up -d --build
```

- Frontend: http://localhost:80 (or `APP_FRONTEND_PORT` from `config.env`)
- Backend API: http://localhost:4001/api/... (or `APP_BACKEND_PORT`) - see `server/index.js` for the full route list
- Postgres: localhost:5432 (or `APP_DB_PORT`)

To change a port, edit `config.env` before running the command above (the frontend bakes `APP_BACKEND_PORT` into its build, so a port change needs a rebuild - `--build` handles that). You can also override ports directly on the command line:

```bash
APP_FRONTEND_PORT=8080 APP_BACKEND_PORT=5000 docker compose up -d
```

The app stores state in the Postgres volume (`pgdata`), so data survives `docker compose down` / `up` cycles; use `docker compose down -v` to also wipe the database.

## Google Sign-In (optional)

Lets someone log in with their Google account instead of a password - **only for an email that
already has an account here** (invited via Settings > Team, or the original setup account); it's
an alternate way to log into an existing account, not a way to self-register one. Hidden on the
login screen until configured. Configurable from **Settings > Server Settings** (Super Admin
only) once the app is running, or via `GOOGLE_CLIENT_ID` before it's ever started - either way
ends up in the same place (the database), and the UI always wins if both are set.

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create or select a project.
2. **APIs & Services > OAuth consent screen** - fill in an app name and support email (External
   user type is fine unless this is a Google Workspace-only deployment). The default scopes
   (openid, email, profile) are all this needs - don't add any others.
3. **APIs & Services > Credentials > Create Credentials > OAuth client ID** - Application type
   **Web application**. Under **Authorized JavaScript origins**, add every origin the app is
   actually opened from, e.g. `http://localhost` and `https://ea-designer.isdaddy.com` (add more
   later the same way if you open it from somewhere else, like a LAN IP). Leave **Authorized
   redirect URIs** empty - this integration only needs the origin, not a redirect.
4. Copy the generated **Client ID** (ends in `.apps.googleusercontent.com` - no client secret is
   needed for this flow) and paste it into **Settings > Server Settings** in the running app (as a
   Super Admin), or into `secrets.env` as `GOOGLE_CLIENT_ID=...` before first start (on the NAS,
   `GOOGLE_CLIENT_ID` in Portainer's stack environment variables instead - see
   `docker-compose.stack.yml`).

## Super Admin

One role above Admin, added for exactly one reason: someone has to be trusted with Server
Settings (the SMTP sender and Google Sign-In's Client ID above) and with granting/revoking Super
Admin itself - an ordinary Admin can't touch either. The very first account (via initial setup, or
promoted automatically on an existing install that predates this role) becomes a Super Admin;
after that, only an existing Super Admin can make another one, from Settings > Team.

If no Super Admin can log in, any Admin can start a recovery request from Settings > Team (Super
Admin Recovery) asking that some Admin - themselves or someone else - be promoted. It takes effect
once every *other* Admin approves via a one-time emailed link (a single rejection kills it), or
immediately if the requester is the only Admin.

## Deploying to a NAS (Portainer stack)

`docker-compose.stack.yml` is the compose file to paste into Portainer as a Stack - unlike
`docker-compose.yml` (which builds from source), it only pulls pre-built images from Docker Hub,
since Portainer/the NAS has no build step. See the comments in that file for one-time Portainer
setup (env vars, webhook).

To build, push to Docker Hub, and redeploy both the local PC stack and the NAS's Portainer stack
in one step, copy `scripts/deploy.example.sh` to `scripts/deploy.sh` (gitignored - it holds your
Docker Hub username and Portainer webhook URL), fill in the placeholders, and run:

```bash
scripts/deploy.sh            # build, update PC, push to Docker Hub, redeploy NAS
scripts/deploy.sh --local    # build and update the PC stack only
```

## Keeping the PC and NAS databases in sync

The PC and NAS each run their own Postgres container, so their data can drift apart. To
overwrite one side's data with the other's, copy `scripts/sync-db.example.sh` to
`scripts/sync-db.sh` (gitignored - it holds your NAS's SSH host and container name), fill in
the placeholders, and run:

```bash
scripts/sync-db.sh --to-nas    # PC data overwrites NAS data
scripts/sync-db.sh --to-pc     # NAS data overwrites PC data
```

This requires SSH access from the PC to the NAS. It's a one-way, destructive copy (the
destination's existing data is dropped), so pick the direction carefully - the script asks
for confirmation before running.

On a Synology NAS, the SSH login user usually can't reach `/var/run/docker.sock` directly
(`permission denied` even for an account in the `administrators` group), so the script runs
remote `docker` commands via a scoped passwordless `sudo` rule. Set this up once by SSHing
into the NAS and, from a root shell (`sudo -i`), running:

```bash
echo "<nas-ssh-user> ALL=(ALL) NOPASSWD: /usr/local/bin/docker" > /etc/sudoers.d/<nas-ssh-user>-docker
chmod 440 /etc/sudoers.d/<nas-ssh-user>-docker
```

(adjust the docker path if `ls /usr/local/bin/docker` doesn't find it on your model/DSM version).

## Local development (frontend only)

```bash
npm install
npm run dev      # Vite dev server with HMR
npm run build    # type-check (tsc -b) + production build
npm run lint      # ESLint
```

The frontend expects a backend reachable at `http://<the host it was loaded from>:<VITE_BACKEND_PORT>` (default `4001`); run the backend separately (`cd server && npm install && node index.js`) with a Postgres instance available, or just use Docker Compose for the full stack.
