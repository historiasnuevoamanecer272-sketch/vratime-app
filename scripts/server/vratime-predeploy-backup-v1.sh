#!/usr/bin/env bash
set -Eeuo pipefail

backup_dir="${1:?Usage: vratime-predeploy-backup-v1.sh /absolute/backup/directory}"
nginx_bin="/www/server/nginx/sbin/nginx"
nginx_vhosts="/www/server/panel/vhost/nginx"
nginx_main="/www/server/nginx/conf/nginx.conf"
webroot="/www/wwwroot/vratime.vzdigital.online"

if [[ -e "$backup_dir" ]]; then
  printf 'Backup directory already exists: %s\n' "$backup_dir" >&2
  exit 1
fi

mkdir -p "$backup_dir"
tar -czf "$backup_dir/nginx-config-before-vratime.tar.gz" "$nginx_vhosts" "$nginx_main"
sha256sum "$backup_dir/nginx-config-before-vratime.tar.gz" > "$backup_dir/SHA256SUMS.txt"

if [[ -e "$webroot" ]]; then
  printf 'WEBROOT=EXISTS\n' > "$backup_dir/STATE.txt"
else
  printf 'WEBROOT=ABSENT\n' > "$backup_dir/STATE.txt"
fi

"$nginx_bin" -t >> "$backup_dir/STATE.txt" 2>&1
printf 'BACKUP_DIR=%s\n' "$backup_dir" >> "$backup_dir/STATE.txt"
printf 'BACKUP_SIZE=' >> "$backup_dir/STATE.txt"
du -sh "$backup_dir" | awk '{print $1}' >> "$backup_dir/STATE.txt"

cat "$backup_dir/STATE.txt"
