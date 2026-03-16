#!/bin/sh

# Authenticate glab if GITLAB_URL and GITLAB_TOKEN are available.
# If not set (user will configure via Web UI), skip and let Node.js handle it at runtime.
if [ -n "${GITLAB_URL}" ] && [ -n "${GITLAB_TOKEN}" ]; then
  # Strip protocol — glab expects hostname only (e.g. "git.bssd.vn", not "https://git.bssd.vn")
  GITLAB_HOST=$(echo "${GITLAB_URL}" | sed 's|^https\?://||' | sed 's|/.*||')

  echo "==> Authenticating glab with GitLab (${GITLAB_HOST})..."
  echo "${GITLAB_TOKEN}" | glab auth login \
    --hostname "${GITLAB_HOST}" \
    --stdin \
    --git-protocol https \
    && echo "==> glab auth OK" \
    || echo "WARNING: glab auth login failed — agent may not be able to use GitLab CLI"
else
  echo "==> GITLAB_URL or GITLAB_TOKEN not set — skipping glab auth (configure via Web UI)"
fi

echo "==> Starting orchestrator..."
exec node dist/index.js
