#!/bin/sh
# Signs dist/firefox (built by ./build.sh) on addons.mozilla.org.
#   ./sign-firefox.sh          unlisted: signed right away, saved as dist/x-thread-toggle-<version>-firefox.xpi
#   ./sign-firefox.sh listed   public listing: submitted with amo-metadata.json; Mozilla reviews it,
#                              the signed file is available on addons.mozilla.org after approval
# API credentials from https://addons.mozilla.org/en-US/developers/addon/api/key/ are read from
# ~/.config/x-thread-toggle/amo-api.env (WEB_EXT_API_KEY=<JWT issuer>, WEB_EXT_API_SECRET=<JWT secret>, chmod 600).
set -eu
cd "$(dirname "$0")"
channel=${1:-unlisted}
case "$channel" in unlisted|listed) ;; *) echo "usage: $0 [unlisted|listed]" >&2; exit 1 ;; esac
creds="$HOME/.config/x-thread-toggle/amo-api.env"
[ -f dist/firefox/manifest.json ] || { echo "dist/firefox is missing: run ./build.sh first" >&2; exit 1; }

set -a; . "$creds"; set +a
: "${WEB_EXT_API_KEY:?missing in $creds}" "${WEB_EXT_API_SECRET:?missing in $creds}"

if [ "$channel" = listed ]; then
  npx --yes web-ext@10.8.0 sign --channel listed --amo-metadata amo-metadata.json --approval-timeout 0 \
    --source-dir dist/firefox --artifacts-dir dist/signed
  exit
fi

version=$(node -p 'require("./dist/firefox/manifest.json").version')
rm -rf dist/signed
npx --yes web-ext@10.8.0 sign --channel unlisted --source-dir dist/firefox --artifacts-dir dist/signed
mv dist/signed/*.xpi "dist/x-thread-toggle-$version-firefox.xpi"
rmdir dist/signed
ls -l "dist/x-thread-toggle-$version-firefox.xpi"
