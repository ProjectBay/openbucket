#!/usr/bin/env bash
#
# Create a bucket and upload a file to a running OpenBucket standalone instance
# using the AWS CLI (path-style, pointed at the local S3 endpoint).
#
# Prereqs:
#   - `docker compose up -d` is running (S3 API on http://localhost:9000)
#   - the AWS CLI is installed
#   - your ROOT_ACCESS_KEY_ID / ROOT_SECRET_ACCESS_KEY from .env
#
# Usage:
#   ./upload.sh [FILE] [BUCKET]
#
set -euo pipefail

FILE="${1:-./hello.txt}"
BUCKET="${2:-demo}"
ENDPOINT="http://localhost:9000"

# Feed the AWS CLI the root credentials from .env (S3 SigV4). Adjust if you
# created a scoped access key in the admin console instead.
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; source ./.env; set +a
fi
export AWS_ACCESS_KEY_ID="${ROOT_ACCESS_KEY_ID:?set ROOT_ACCESS_KEY_ID in .env}"
export AWS_SECRET_ACCESS_KEY="${ROOT_SECRET_ACCESS_KEY:?set ROOT_SECRET_ACCESS_KEY in .env}"
export AWS_DEFAULT_REGION="${OPENBUCKET_REGION:-us-east-1}"

# A sample file if none was given.
if [[ ! -f "$FILE" ]]; then
  echo "hello from OpenBucket $(date)" > "$FILE"
fi

echo "→ Creating bucket '$BUCKET' (ignored if it already exists)…"
aws --endpoint-url "$ENDPOINT" s3 mb "s3://$BUCKET" || true

echo "→ Uploading '$FILE' → s3://$BUCKET/…"
aws --endpoint-url "$ENDPOINT" s3 cp "$FILE" "s3://$BUCKET/"

echo "→ Listing s3://$BUCKET/ …"
aws --endpoint-url "$ENDPOINT" s3 ls "s3://$BUCKET/"

echo
echo "Done. Browse it in the admin console: $ENDPOINT/admin"

# Equivalent low-level upload with curl (presigned URLs or SigV4 signing are
# required for the raw S3 API, so the AWS CLI above is the simplest path). If you
# expose an app upload route instead, a plain multipart POST looks like:
#
#   curl -F "file=@$FILE" http://localhost:9000/files
