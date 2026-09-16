#!/usr/bin/env bash
# ==========================================
# EA Designer - manual DB sync (template)
# ==========================================
# Copy this file to scripts/sync-db.sh (gitignored - it's machine-specific, not project
# source) and fill in the values below. It dumps Postgres from one side (PC or NAS) over
# SSH and restores it into the other side, completely replacing the destination's data.
#
# Requires SSH access from this PC to the NAS (enable SSH in Synology's Control Panel if
# it isn't already), and that both sides' `db` containers are running.
#
# Usage:
#   scripts/sync-db.sh --to-nas    # PC data overwrites NAS data
#   scripts/sync-db.sh --to-pc     # NAS data overwrites PC data
#
# Add -y/--yes to skip the confirmation prompt (e.g. for scripting).

set -euo pipefail

# ---- Fill these in for your setup ----
NAS_SSH_HOST="user@your-nas-ip"      # an account on the NAS with docker exec permission (SSH)
NAS_SSH_PORT="22"                    # NAS's SSH port
NAS_DB_CONTAINER="ea-designer-db-1"  # run `docker ps` on the NAS to confirm the actual name
# ---------------------------------------

LOCAL_DB_CONTAINER="ea_designer-db-1"
PGUSER="postgres"
PGDATABASE="eadesigner"

DIRECTION=""
ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    --to-nas) DIRECTION="to-nas" ;;
    --to-pc) DIRECTION="to-pc" ;;
    -y|--yes) ASSUME_YES=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

if [ -z "$DIRECTION" ]; then
  echo "Usage: $0 --to-nas|--to-pc [-y|--yes]" >&2
  exit 1
fi

if [ "$DIRECTION" = "to-nas" ]; then
  SRC_DESC="PC ($LOCAL_DB_CONTAINER)"
  DST_DESC="NAS ($NAS_SSH_HOST:$NAS_DB_CONTAINER)"
else
  SRC_DESC="NAS ($NAS_SSH_HOST:$NAS_DB_CONTAINER)"
  DST_DESC="PC ($LOCAL_DB_CONTAINER)"
fi

echo "This will REPLACE all data on $DST_DESC with data dumped from $SRC_DESC."
if [ "$ASSUME_YES" != true ]; then
  read -r -p "Continue? [y/N] " reply
  case "$reply" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

DUMP_CMD="pg_dump -U $PGUSER -d $PGDATABASE --clean --if-exists"
RESTORE_CMD="psql -U $PGUSER -d $PGDATABASE"

# On Synology, the SSH login user typically can't reach /var/run/docker.sock directly, so
# remote docker commands run via a scoped passwordless sudo rule - see README.md for the
# one-time `/etc/sudoers.d` setup. Adjust the docker path if yours differs (`which docker`
# won't show it non-interactively - check `ls /usr/local/bin/docker` instead).
NAS_DOCKER="sudo -n /usr/local/bin/docker"

if [ "$DIRECTION" = "to-nas" ]; then
  echo "==> Dumping $SRC_DESC and restoring into $DST_DESC"
  docker exec "$LOCAL_DB_CONTAINER" $DUMP_CMD | ssh -p "$NAS_SSH_PORT" "$NAS_SSH_HOST" "$NAS_DOCKER exec -i $NAS_DB_CONTAINER $RESTORE_CMD"
else
  echo "==> Dumping $SRC_DESC and restoring into $DST_DESC"
  ssh -p "$NAS_SSH_PORT" "$NAS_SSH_HOST" "$NAS_DOCKER exec $NAS_DB_CONTAINER $DUMP_CMD" | docker exec -i "$LOCAL_DB_CONTAINER" $RESTORE_CMD
fi

echo "==> Done."
