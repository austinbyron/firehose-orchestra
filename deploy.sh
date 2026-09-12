#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
npm test
rm -rf dist && mkdir dist
cp index.html dist/
cp -R src fixtures dist/
npx wrangler pages deploy dist --project-name=firehose-orchestra --branch=main
