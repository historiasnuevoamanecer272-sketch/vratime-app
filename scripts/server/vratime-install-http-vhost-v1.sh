#!/usr/bin/env bash
set -Eeuo pipefail

source_path="${1:?Usage: vratime-install-http-vhost-v1.sh /path/to/vratime.conf}"
nginx_bin="/www/server/nginx/sbin/nginx"
vhost_path="/www/server/panel/vhost/nginx/vratime.vzdigital.online.conf"
temp_path="${vhost_path}.vratime-tmp"

test -f "$source_path"

if [[ -e "$vhost_path" ]]; then
  printf 'Vhost already exists: %s\n' "$vhost_path" >&2
  exit 1
fi

install -m 0644 "$source_path" "$temp_path"

if ! "$nginx_bin" -t; then
  rm -f "$temp_path"
  exit 1
fi

mv "$temp_path" "$vhost_path"

if ! "$nginx_bin" -t; then
  rm -f "$vhost_path"
  "$nginx_bin" -t
  exit 1
fi

"$nginx_bin" -s reload
printf 'ACTIVE_VHOST=%s\n' "$vhost_path"
