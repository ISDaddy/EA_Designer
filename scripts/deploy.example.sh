#!/usr/bin/env bash
# ==========================================
# EA Designer - build & deploy script (template)
# ==========================================
# Copy this file to scripts/deploy.sh (gitignored - it's machine-specific, not project source)
# and fill in the values below. It:
#   1. Rebuilds the frontend/backend images from source.
#   2. Updates your local PC stack (docker-compose.yml) with the freshly built images.
#   3. Pushes the images to Docker Hub.
#   4. Triggers your NAS's Portainer stack to pull the new images and redeploy, via a
#      Portainer stack webhook (Stacks -> your stack -> Webhook, in the Portainer UI).
#
# Usage:
#   scripts/deploy.sh            # build, update PC, push, redeploy NAS
#   scripts/deploy.sh --local    # build and update the PC stack only, skip Docker Hub/NAS

set -euo pipefail
cd "$(dirname "$0")/.."

# ---- Fill these in for your setup ----
DOCKERHUB_USER="yourdockerhubuser"
PORTAINER_WEBHOOK_URL=""   # e.g. https://your-nas:9443/api/stacks/webhooks/xxxxxxxx-xxxx-...
# ---------------------------------------

IMAGE_TAG="${IMAGE_TAG:-latest}"
FRONTEND_IMAGE="$DOCKERHUB_USER/ea-designer-frontend"
BACKEND_IMAGE="$DOCKERHUB_USER/ea-designer-backend"
LOCAL_ONLY=false
[ "${1:-}" = "--local" ] && LOCAL_ONLY=true

echo "==> Updating local PC stack (docker compose build + up)"
docker compose --env-file config.env up -d --build

if [ "$LOCAL_ONLY" = true ]; then
  echo "==> --local passed, skipping Docker Hub push and NAS redeploy"
  exit 0
fi

echo "==> Tagging images for Docker Hub"
docker tag ea-designer-frontend:local "$FRONTEND_IMAGE:$IMAGE_TAG"
docker tag ea-designer-backend:local "$BACKEND_IMAGE:$IMAGE_TAG"

echo "==> Pushing images to Docker Hub"
docker push "$FRONTEND_IMAGE:$IMAGE_TAG"
docker push "$BACKEND_IMAGE:$IMAGE_TAG"

if [ -n "$PORTAINER_WEBHOOK_URL" ]; then
  echo "==> Triggering NAS redeploy via Portainer webhook"
  curl -fsS -X POST "$PORTAINER_WEBHOOK_URL"
  echo
else
  echo "==> PORTAINER_WEBHOOK_URL not set - skipping NAS redeploy trigger"
fi

echo "==> Done."
