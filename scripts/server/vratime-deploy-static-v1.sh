#!/usr/bin/env bash
set -Eeuo pipefail

archive_path="${1:?Usage: vratime-deploy-static-v1.sh /path/to/dist.tar.gz release-id}"
release_id="${2:?Usage: vratime-deploy-static-v1.sh /path/to/dist.tar.gz release-id}"
webroot="/www/wwwroot/vratime.vzdigital.online"
releases_dir="$webroot/releases"
release_dir="$releases_dir/$release_id"
stage_dir="$releases_dir/.${release_id}.stage"
public_url="${VRATIME_PUBLIC_URL:-https://vratime.vzdigital.online}"
previous_target=""

if [[ ! "$release_id" =~ ^[A-Za-z0-9._-]+$ ]]; then
  printf 'Invalid release id: %s\n' "$release_id" >&2
  exit 1
fi

if [[ ! -f "$archive_path" ]]; then
  printf 'Archive not found: %s\n' "$archive_path" >&2
  exit 1
fi

if [[ -e "$release_dir" || -e "$stage_dir" ]]; then
  printf 'Release path already exists: %s\n' "$release_id" >&2
  exit 1
fi

mkdir -p "$releases_dir"
mkdir "$stage_dir"
trap 'rm -rf "$stage_dir"' EXIT

tar -xzf "$archive_path" -C "$stage_dir"
test -f "$stage_dir/index.html"
test -f "$stage_dir/manifest.webmanifest"
expected_js="$(grep -o 'assets/index-[^" ]*\.js' "$stage_dir/index.html" | head -n 1)"
expected_css="$(grep -o 'assets/index-[^" ]*\.css' "$stage_dir/index.html" | head -n 1)"
test -n "$expected_js"
test -n "$expected_css"

printf 'RELEASE_ID=%s\nDEPLOYED_AT_UTC=%s\n' "$release_id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$stage_dir/RELEASE.txt"
mv "$stage_dir" "$release_dir"
trap - EXIT

if [[ -L "$webroot/current" ]]; then
  previous_target="$(readlink -f "$webroot/current")"
fi

ln -s "$release_dir" "$webroot/.current-$release_id"
mv -Tf "$webroot/.current-$release_id" "$webroot/current"

rollback_current() {
  if [[ -n "$previous_target" && -d "$previous_target" ]]; then
    ln -s "$previous_target" "$webroot/.rollback-$release_id"
    mv -Tf "$webroot/.rollback-$release_id" "$webroot/current"
  fi
}

if ! live_html="$(curl --fail --silent --show-error --max-time 20 -H 'Cache-Control: no-cache' "$public_url/?release=$release_id")"; then
  rollback_current
  printf 'Production HTTP verification failed; current was restored to %s\n' "$previous_target" >&2
  exit 1
fi
if ! live_release="$(curl --fail --silent --show-error --max-time 20 -H 'Cache-Control: no-cache' "$public_url/RELEASE.txt?release=$release_id")"; then
  rollback_current
  printf 'Production release verification failed; current was restored to %s\n' "$previous_target" >&2
  exit 1
fi

if [[ "$live_html" != *"$expected_js"* || "$live_html" != *"$expected_css"* || "$live_release" != *"RELEASE_ID=$release_id"* ]]; then
  rollback_current
  printf 'Production verification failed; current was restored to %s\n' "$previous_target" >&2
  exit 1
fi

printf 'ACTIVE_RELEASE=%s\n' "$(readlink -f "$webroot/current")"
printf 'VERIFIED_JS=%s\nVERIFIED_CSS=%s\n' "$expected_js" "$expected_css"
