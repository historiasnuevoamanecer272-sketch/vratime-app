#!/usr/bin/env bash
set -Eeuo pipefail

source_path="${1:?Usage: vratime-enable-https-v1.sh /path/to/vratime.conf /absolute/backup/directory}"
backup_dir="${2:?Usage: vratime-enable-https-v1.sh /path/to/vratime.conf /absolute/backup/directory}"
nginx_bin="/www/server/nginx/sbin/nginx"
vhost_path="/www/server/panel/vhost/nginx/vratime.vzdigital.online.conf"
temp_path="${vhost_path}.vratime-tmp"
certificate_path="/etc/letsencrypt/live/vratime.vzdigital.online/fullchain.pem"
private_key_path="/etc/letsencrypt/live/vratime.vzdigital.online/privkey.pem"

test -f "$source_path"
test -f "$vhost_path"
test -d "$backup_dir"
test -f "$certificate_path"
test -f "$private_key_path"

cp -p "$vhost_path" "$backup_dir/vratime-http-vhost-before-https.conf"
install -m 0644 "$source_path" "$temp_path"
mv "$temp_path" "$vhost_path"

if ! "$nginx_bin" -t; then
  cp -p "$backup_dir/vratime-http-vhost-before-https.conf" "$vhost_path"
  "$nginx_bin" -t
  exit 1
fi

"$nginx_bin" -s reload
printf 'HTTPS_VHOST=%s\n' "$vhost_path"
