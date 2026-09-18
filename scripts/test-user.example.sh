#!/usr/bin/env bash
# ==========================================
# EA Designer - throwaway local test user (template)
# ==========================================
# Copy this file to scripts/test-user.sh (gitignored - it's machine-specific, not project
# source) and adjust the container/db names below if yours differ from docker-compose's
# defaults. Creates or deletes a disposable local account for testing role-based behavior
# (system_owner, admin, viewer, ...) without needing invite emails or the real account's
# password, and without ever touching the NAS.
#
# Why this exists: testing multiple roles/accounts against this app previously meant
# inviting real-looking test accounts through the UI and logging into them in the browser
# - but Claude in Chrome's tab group shares ONE cookie jar across all its tabs, so logging
# into a second account in the browser silently logs the first one out (including your own
# real admin session, if that's what was open). Prefer this script + curl for any account
# whose *state* you need to drive but don't need to visually see rendered - reserve the
# actual browser tab for the one perspective you need on screen. See README.md/CLAUDE.md.
#
# Usage:
#   scripts/test-user.sh create <email> <role> [name]   # role: admin|editor|system_owner|viewer|superadmin
#   scripts/test-user.sh delete <email>
#   scripts/test-user.sh login <email>                  # prints a curl -c/-b cookie-jar snippet
#
# The password for every account this script creates is always: TestPass123!
# Deleting a user cascades to their change_requests, notifications, and sessions.

set -euo pipefail

DB_CONTAINER="ea_designer-db-1"
BACKEND_CONTAINER="ea_designer-backend-1"
PGUSER="postgres"
PGDATABASE="eadesigner"
TEST_PASSWORD="TestPass123!"

cmd="${1:-}"
email="${2:-}"

case "$cmd" in
  create)
    role="${3:-viewer}"
    name="${4:-Test ${role^}}"
    id="user-test-$(date +%s)"
    if [ -z "$email" ]; then echo "Usage: $0 create <email> <role> [name]" >&2; exit 1; fi
    hash=$(docker exec "$BACKEND_CONTAINER" node -e "console.log(require('bcryptjs').hashSync('$TEST_PASSWORD', 10))")
    docker exec "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -c \
      "INSERT INTO users (id, email, password_hash, name, role, nda_accepted_version) VALUES ('$id', '$email', '$hash', '$name', '$role', 'v1');"
    echo "==> Created $role account $email (password: $TEST_PASSWORD, id: $id)"
    ;;
  delete)
    if [ -z "$email" ]; then echo "Usage: $0 delete <email>" >&2; exit 1; fi
    docker exec "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -c "DELETE FROM users WHERE email = '$email';"
    echo "==> Deleted $email (and their change_requests/notifications/sessions via cascade)"
    ;;
  login)
    if [ -z "$email" ]; then echo "Usage: $0 login <email>" >&2; exit 1; fi
    jar="/tmp/${email//[^a-zA-Z0-9]/_}_cookies.txt"
    curl -s -c "$jar" -X POST http://localhost/api/auth/login -H "Content-Type: application/json" \
      -d "{\"email\":\"$email\",\"password\":\"$TEST_PASSWORD\"}"
    echo
    echo "==> Cookie jar: $jar - reuse with: curl -b $jar http://localhost/api/..."
    ;;
  *)
    echo "Usage: $0 create <email> <role> [name] | delete <email> | login <email>" >&2
    exit 1
    ;;
esac
