#!/usr/bin/env bash
# Build and deploy Hosting, Firestore rules and the Remote Config template.
set -euo pipefail
cd "$(dirname "$0")/.."
(cd web && npm run build)
firebase deploy --project before-you-pay-9b8c6 --only hosting,firestore:rules,remoteconfig
