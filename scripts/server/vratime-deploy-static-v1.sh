#!/usr/bin/env bash
set -Eeuo pipefail

archive_path="${1:?Usage: vratime-deploy-static-v1.sh /path/to/dist.tar.gz release-id}"
release_id="${2:?Usage: vratime-deploy-static-v1.sh /path/to/dist.tar.gz release-id}"
webroot="/www/wwwroot/vratime.vzdigital.online"
releases_dir="$webroot/releases"
release_dir="$releases_dir/$release_id"
stage_dir="$releases_dir/.${release_id}.stage"

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

printf 'RELEASE_ID=%s\nDEPLOYED_AT_UTC=%s\n' "$release_id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$stage_dir/RELEASE.txt"
mv "$stage_dir" "$release_dir"
trap - EXIT

ln -s "$release_dir" "$webroot/.current-$release_id"
mv -Tf "$webroot/.current-$release_id" "$webroot/current"

printf 'ACTIVE_RELEASE=%s\n' "$(readlink -f "$webroot/current")"
