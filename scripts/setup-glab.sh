#!/bin/sh
set -e

echo "==> Authenticating glab with GitLab..."
echo "${GITLAB_TOKEN}" | glab auth login \
  --hostname "${GITLAB_URL}" \
  --stdin \
  --git-protocol https

echo "==> Setting default GitLab host..."
glab config set host "${GITLAB_URL}"

echo "==> Verifying glab auth..."
glab auth status

echo "==> Starting orchestrator..."
exec node dist/index.js
