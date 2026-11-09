#!/bin/sh
# Signs dist/firefox (built by ./build.sh) as an unlisted add-on on addons.mozilla.org
# and saves the result as dist/x-thread-toggle-<version>-firefox.xpi.
# API credentials from https://addons.mozilla.org/en-US/developers/addon/api/key/ are read from
# ~/.config/x-thread-toggle/amo-api.env (WEB_EXT_API_KEY=<JWT issuer>, WEB_EXT_API_SECRET=<JWT secret>, chmod 600).
set -eu
cd "$(dirname "$0")"
creds="$HOME/.config/x-thread-toggle/amo-api.env"
[ -f dist/firefox/manifest.json ] || { echo "dist/firefox is missing: run ./build.sh first" >&2; exit 1; }

set -a; . "$creds"; set +a
: "${WEB_EXT_API_KEY:?missing in $creds}" "${WEB_EXT_API_SECRET:?missing in $creds}"

version=$(node -p 'require("./dist/firefox/manifest.json").version')
rm -rf dist/signed
npx --yes web-ext@10.8.0 sign --channel unlisted --source-dir dist/firefox --artifacts-dir dist/signed
mv dist/signed/*.xpi "dist/x-thread-toggle-$version-firefox.xpi"
rmdir dist/signed
ls -l "dist/x-thread-toggle-$version-firefox.xpi"
