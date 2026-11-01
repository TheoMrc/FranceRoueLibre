# francerouelibre.fr on this VPS: static site served by nginx from /var/www/francerouelibre-web.
# 1. clone or update the GitHub repo in /var/www/francerouelibre (shallow: only the current version, to save disk),
#    then copy dist/ to the served folder with rsync: only changed files are written, each one to a temporary name then
#    renamed at the end, so visitors never read a half-written file (the 600 Mo search index above all)
# 2. Let's Encrypt certificate once the DNS points here (webroot, nginx keeps running)
# 3. nginx vhost (HTTP only until the certificate exists, then HTTPS with http and www redirected to https://francerouelibre.fr)
# 4. nginx -t, reload, live check
# Built for rushes (thousands of visitors in a few minutes): text files are gzipped once at deploy time and served as
# they are (gzip_static, no CPU per visit), open files are cached, HTTP/2, the search API sits behind nginx's cache,
# nginx gets more connections per worker, and a 2 Go swap file guards the shared VPS against running out of memory.
set -euo pipefail
DIR=/var/www/francerouelibre
WEB=/var/www/francerouelibre-web
REPO=https://github.com/TheoMrc/FranceRoueLibre.git
CONF=/etc/nginx/sites-available/francerouelibre.fr
CERT=/etc/letsencrypt/live/francerouelibre.fr/fullchain.pem
ME=$(id -un)

echo "== repo"
if [ ! -d "$DIR/.git" ]; then
  sudo -n mkdir -p "$DIR" && sudo -n chown "$ME":"$ME" "$DIR"
  git clone --depth 1 --branch main "$REPO" "$DIR"
else
  git -C "$DIR" fetch --depth 1 origin main
  git -C "$DIR" reset --hard origin/main
fi
git -C "$DIR" log -1 --oneline
du -sh "$DIR/dist" "$DIR/.git"
echo "== precompress (gzip -9 next to each text file, served as is by nginx: no CPU per visit)"
# Only new or changed files (a .gz keeps the time of its source); a .gz whose source is gone is removed. The search
# index is read by range requests: never compressed.
find "$DIR/dist" -type f -name '*.gz' ! -path "$DIR/dist/data/search/db/*" -print0 | while IFS= read -r -d '' gz; do
  [ -f "${gz%.gz}" ] || rm -f "$gz"; done
n=0
while IFS= read -r -d '' f; do
  if [ ! -f "$f.gz" ] || [ "$f" -nt "$f.gz" ] || [ "$f.gz" -nt "$f" ]; then
    nice -n 15 gzip -9 -n -k -f "$f" && touch -r "$f" "$f.gz"; n=$((n + 1)); fi
done < <(find "$DIR/dist" -type f \( -name '*.html' -o -name '*.css' -o -name '*.js' -o -name '*.mjs' -o -name '*.json' \
  -o -name '*.geojson' -o -name '*.svg' -o -name '*.wasm' -o -name '*.txt' -o -name '*.xml' \) -size +1k \
  ! -path "$DIR/dist/data/search/db/*" -print0)
echo "$n file(s) compressed, $(find "$DIR/dist" -name '*.gz' ! -path '*/search/db/*' | wc -l) in all"
echo "== publish (only changed files, swapped at the end)"
command -v rsync >/dev/null || sudo -n apt-get install -y -q rsync
[ -d "$WEB" ] || { sudo -n mkdir -p "$WEB" && sudo -n chown "$ME":"$ME" "$WEB"; }
rsync -a --checksum --delete --delay-updates --chmod=Da+rx,Fa+r --itemize-changes "$DIR/dist/" "$WEB/" | { grep -v '^\.' || true; } | awk 'NR<=20; END {print NR " changed"}'

write_conf() {
  local https=$1
  {
    echo "# francerouelibre.fr – written by deploy/vps.sh (FranceRoueLibre repo), static files from $WEB"
    echo "limit_req_zone \$binary_remote_addr zone=frl_api:10m rate=5r/s;"
echo "limit_req_zone \$binary_remote_addr zone=frl_ai:10m rate=3r/s;"
    # Answers of the search API, shared by all visitors: keys in memory (20 Mo), answers on disk (500 Mo at most)
    echo "proxy_cache_path /var/cache/nginx/frl levels=1:2 keys_zone=frl_search:20m max_size=500m inactive=2h use_temp_path=off;"
    # Own access log, without query strings (searched words never reach the disk), read by frl-stats
    cat <<'NGX'
map $http_referer $frl_referer { default $http_referer; "~^(?<frl_ref_base>[^?]*)\?" $frl_ref_base; }
log_format frl '$remote_addr [$time_local] "$request_method $uri $server_protocol" $status $body_bytes_sent "$frl_referer" "$http_user_agent"';
NGX
    if [ "$https" = 1 ]; then
      cat <<'NGX'
server {
    listen 80; listen [::]:80;
    server_name francerouelibre.fr www.francerouelibre.fr;
    location /.well-known/acme-challenge/ { root /var/www/francerouelibre/dist; }
    location / { return 301 https://francerouelibre.fr$request_uri; }
}
server {
    listen 443 ssl; listen [::]:443 ssl; http2 on;
    server_name www.francerouelibre.fr;
    ssl_certificate     /etc/letsencrypt/live/francerouelibre.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/francerouelibre.fr/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;
    return 301 https://francerouelibre.fr$request_uri;
}
server {
    listen 443 ssl; listen [::]:443 ssl; http2 on;
    server_name francerouelibre.fr;
    ssl_certificate     /etc/letsencrypt/live/francerouelibre.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/francerouelibre.fr/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;
    add_header Strict-Transport-Security "max-age=31536000" always;
NGX
    else
      cat <<'NGX'
server {
    listen 80; listen [::]:80;
    server_name francerouelibre.fr www.francerouelibre.fr;
NGX
    fi
    cat <<'NGX'
    root /var/www/francerouelibre-web;
    access_log /var/log/nginx/francerouelibre.access.log frl;
    index index.html;
    charset utf-8;
    gzip on; gzip_vary on; gzip_proxied any; gzip_comp_level 6; gzip_min_length 512;
    gzip_types text/plain text/css application/javascript text/javascript application/json application/geo+json image/svg+xml application/wasm;
    # The .gz written at deploy time (gzip -9) are sent as they are; on-the-fly gzip only for what has none
    gzip_static on;
    open_file_cache max=20000 inactive=120s; open_file_cache_valid 60s; open_file_cache_errors on;
    location / { try_files $uri $uri/ =404; expires 10m; }
    # Let's Encrypt (^~ wins over the dotfile rule below)
    location ^~ /.well-known/acme-challenge/ { root /var/www/francerouelibre/dist; default_type text/plain; }
    # Search index: read by HTTP range requests (nginx serves ranges natively); never gzip these
    location /data/search/db/ { gzip off; add_header Cache-Control "no-cache" always; add_header Strict-Transport-Security "max-age=31536000" always; }
    location ~ \.geojson$ { default_type application/json; expires 10m; }
    # Search API (server/search_api.py, systemd unit francerouelibre-search)
    # AI assistant (server/assistant_api.py, systemd unit francerouelibre-assistant); answers 502 when not installed
    location /api/assistant/ {
        limit_req zone=frl_ai burst=10 nodelay; limit_req_status 429;
        client_max_body_size 64k;
        proxy_pass http://127.0.0.1:8018; proxy_read_timeout 30s;
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr;
    }
    # Search API behind nginx's cache: a search already made by someone (10 min, the API's Cache-Control) is answered
    # by nginx; when many visitors type the same words at once, one request reaches the API (proxy_cache_lock); the
    # last answer is served while the API is busy or restarting.
    location = /api/search {
        limit_req zone=frl_api burst=20 nodelay; limit_req_status 429;
        proxy_cache frl_search; proxy_cache_lock on; proxy_cache_lock_timeout 12s; proxy_cache_background_update on;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        add_header X-Cache $upstream_cache_status always;
        add_header Strict-Transport-Security "max-age=31536000" always;
        proxy_pass http://127.0.0.1:8017; proxy_read_timeout 20s;
        proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location /api/ {
        limit_req zone=frl_api burst=20 nodelay; limit_req_status 429;
        proxy_pass http://127.0.0.1:8017; proxy_read_timeout 20s;
        proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location ~ /\. { deny all; }
}
NGX
  } | sudo -n tee "$CONF" > /dev/null
  sudo -n ln -sf "$CONF" /etc/nginx/sites-enabled/francerouelibre.fr
}

echo "== search API"
# The API reads the index as one file: rebuilt from the published parts when meta.json changes.
LIB=/var/lib/francerouelibre
DBF=$LIB/frl-search.sqlite3
[ -d "$LIB" ] || { sudo -n mkdir -p "$LIB" && sudo -n chown "$ME":"$ME" "$LIB"; }
STAMP=$(md5sum "$WEB/data/search/meta.json" | cut -d' ' -f1)
if [ ! -f "$DBF" ] || [ "$(cat "$LIB/meta.md5" 2>/dev/null)" != "$STAMP" ]; then
  cat "$WEB"/data/search/db/frl-search.sqlite3.* > "$DBF.tmp" && mv -f "$DBF.tmp" "$DBF" && echo "$STAMP" > "$LIB/meta.md5"
  chmod a+r "$DBF"; echo "index rebuilt: $(du -h "$DBF" | cut -f1)"
  sudo -n find /var/cache/nginx/frl -type f -delete 2>/dev/null || true  # cached answers came from the old index
fi
# NumPy (vectorised totals, 4 to 5 times faster on very common words) in a private virtualenv: nothing is installed
# system-wide, so the other sites of the VPS are not affected. Without it the API falls back to SQL aggregations.
PY=/usr/bin/python3
if [ -x "$LIB/venv/bin/python" ] && "$LIB/venv/bin/python" -c 'import numpy' 2>/dev/null; then PY=$LIB/venv/bin/python
elif python3 -m venv "$LIB/venv" 2>/dev/null && "$LIB/venv/bin/pip" install -q --disable-pip-version-check numpy; then PY=$LIB/venv/bin/python
else echo "NumPy unavailable (python3-venv missing?): SQL aggregations"; fi
sudo -n tee /etc/systemd/system/francerouelibre-search.service > /dev/null <<UNIT
[Unit]
Description=FranceRoueLibre search API (deploy/vps.sh)
After=network.target

[Service]
User=www-data
ExecStart=$PY $DIR/server/search_api.py --db $DBF --port 8017
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
# Shares the VPS with other sites: at most one CPU core, 512 Mo of memory, lower priority
MemoryMax=512M
CPUQuota=100%
Nice=10
IOWeight=50

[Install]
WantedBy=multi-user.target
UNIT
sudo -n systemctl daemon-reload
sudo -n systemctl enable --quiet francerouelibre-search
# Restarted only when its code, its unit or the index changed (a restart reloads 1.9 M lines, about 8 s of CPU)
SIG=$(cat "$DIR/server/search_api.py" /etc/systemd/system/francerouelibre-search.service "$LIB/meta.md5" | md5sum | cut -d' ' -f1)
if [ "$(cat "$LIB/service.md5" 2>/dev/null)" != "$SIG" ] || ! systemctl is-active --quiet francerouelibre-search; then
  sudo -n systemctl restart francerouelibre-search && echo "$SIG" > "$LIB/service.md5" && echo "search API restarted"
else echo "search API unchanged, not restarted"; fi
curl -s --retry 10 --retry-connrefused --retry-delay 1 --max-time 30 http://127.0.0.1:8017/api/health; echo
sudo -n systemctl --no-pager --lines=3 status francerouelibre-search | grep -E "Active|Memory|columns|NumPy|CPU"

echo "== AI assistant"
# Installed only when /etc/francerouelibre/assistant.env exists (keys, root only, never in the repo; see
# deploy/assistant.env.example). Sandboxed service: throwaway system user, read-only system, no home, its own state
# folder for the spending ledger, 256 Mo and half a core at most. The Vertex AI service account key, if present, is
# handed to the service by systemd (LoadCredential) and readable by it alone.
AENV=/etc/francerouelibre/assistant.env
if sudo -n test -f "$AENV"; then
  APY=/usr/bin/python3
  if [ -x "$LIB/venv/bin/python" ]; then
    "$LIB/venv/bin/python" -c 'import google.auth, requests' 2>/dev/null || "$LIB/venv/bin/pip" install -q --disable-pip-version-check google-auth requests
    APY=$LIB/venv/bin/python
  fi
  CRED=""
  if sudo -n test -f /etc/francerouelibre/vertex-sa.json; then
    CRED=$'LoadCredential=vertex.json:/etc/francerouelibre/vertex-sa.json\nEnvironment=GOOGLE_APPLICATION_CREDENTIALS=%d/vertex.json'
  fi
  sudo -n tee /etc/systemd/system/francerouelibre-assistant.service > /dev/null <<UNIT
[Unit]
Description=FranceRoueLibre AI assistant API (deploy/vps.sh)
After=network-online.target francerouelibre-search.service
Wants=network-online.target

[Service]
DynamicUser=yes
StateDirectory=francerouelibre-assistant
EnvironmentFile=$AENV
Environment=ASSISTANT_ENV_FILE=/dev/null ASSISTANT_DATA_DIR=$WEB/data ASSISTANT_SEARCH_DB=$DBF ASSISTANT_SEARCH_API=http://127.0.0.1:8017
$CRED
ExecStart=$APY $DIR/server/assistant_api.py --port 8018
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictNamespaces=yes
RestrictSUIDSGID=yes
LockPersonality=yes
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallFilter=@system-service
MemoryMax=256M
CPUQuota=50%
Nice=10

[Install]
WantedBy=multi-user.target
UNIT
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable --quiet francerouelibre-assistant
  ASIG=$(cat "$DIR"/server/assistant_api.py "$DIR"/server/assistant/*.py /etc/systemd/system/francerouelibre-assistant.service | md5sum | cut -d' ' -f1)
  ASIG=$ASIG$(sudo -n md5sum "$AENV" | cut -c1-8)
  if [ "$(cat "$LIB/assistant.md5" 2>/dev/null)" != "$ASIG" ] || ! systemctl is-active --quiet francerouelibre-assistant; then
    sudo -n systemctl restart francerouelibre-assistant && echo "$ASIG" > "$LIB/assistant.md5" && echo "assistant restarted"
  else echo "assistant unchanged, not restarted"; fi
  curl -s --retry 5 --retry-connrefused --retry-delay 1 --max-time 20 http://127.0.0.1:8018/api/assistant/status; echo
  sudo -n env STATE_DIRECTORY=/var/lib/francerouelibre-assistant ASSISTANT_ENV_FILE="$AENV" "$APY" "$DIR/server/assistant_api.py" --usage 2>/dev/null || true
else
  echo "not installed ($AENV missing, see deploy/assistant.env.example)"
  if systemctl is-active --quiet francerouelibre-assistant 2>/dev/null; then sudo -n systemctl disable --now francerouelibre-assistant; fi
fi

echo "== visit statistics (frl-stats)"
# CLI over the access log (server/frl_stats.py); a nightly timer keeps daily counts once the logs are rotated away
sudo -n ln -sf "$DIR/server/frl_stats.py" /usr/local/bin/frl-stats
sudo -n chmod a+rx "$DIR/server/frl_stats.py"
sudo -n tee /etc/systemd/system/francerouelibre-stats.service > /dev/null <<UNIT
[Unit]
Description=FranceRoueLibre daily visit counts (deploy/vps.sh)

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 $DIR/server/frl_stats.py --save
Nice=15
IOWeight=20
UNIT
sudo -n tee /etc/systemd/system/francerouelibre-stats.timer > /dev/null <<UNIT
[Unit]
Description=FranceRoueLibre daily visit counts

[Timer]
OnCalendar=*-*-* 00:20
Persistent=true

[Install]
WantedBy=timers.target
UNIT
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now --quiet francerouelibre-stats.timer
echo "frl-stats installed; next run: $(systemctl show francerouelibre-stats.timer -p NextElapseUSecRealtime --value)"

echo "== dns"
PUBLIC=$(curl -4 -s --max-time 5 https://ifconfig.me || true)
APEX=$(getent ahostsv4 francerouelibre.fr | awk 'NR==1{print $1}' || true)
WWW=$(getent ahostsv4 www.francerouelibre.fr | awk 'NR==1{print $1}' || true)
echo "VPS $PUBLIC · francerouelibre.fr -> ${APEX:-?} · www -> ${WWW:-?}"

# Writes the vhost and reloads nginx only if the whole configuration is valid; otherwise puts the previous file back,
# so a mistake here can never stop the other sites of the VPS from reloading.
apply_conf() {
  sudo -n test -f "$CONF" && sudo -n cp -f "$CONF" "$CONF.prev"
  write_conf "$1"
  if sudo -n nginx -t 2>&1 | tail -2; [ "${PIPESTATUS[0]}" = 0 ]; then sudo -n systemctl reload nginx
  else echo "nginx -t FAILED: previous vhost restored"; sudo -n test -f "$CONF.prev" && sudo -n cp -f "$CONF.prev" "$CONF"; sudo -n nginx -t; return 1; fi
}

echo "== capacity (shared settings, applied once)"
# nginx: 4096 connections per worker instead of 768 (Ubuntu's default), enough open files for them. Checked with
# nginx -t, the previous nginx.conf is put back if it fails.
NCONF=/etc/nginx/nginx.conf
if ! sudo -n grep -qE '^\s*worker_connections 4096;' "$NCONF"; then
  sudo -n cp -f "$NCONF" "$NCONF.bak-frl"
  sudo -n sed -i -E 's/^(\s*)worker_connections\s+[0-9]+;/\1worker_connections 4096;/' "$NCONF"
  sudo -n grep -q '^worker_rlimit_nofile' "$NCONF" || sudo -n sed -i '/^worker_processes/a worker_rlimit_nofile 16384;' "$NCONF"
  if sudo -n nginx -t 2>/dev/null; then echo "nginx.conf: 4096 connections per worker"
  else sudo -n cp -f "$NCONF.bak-frl" "$NCONF"; echo "nginx.conf change refused by nginx -t: previous file restored"; fi
fi
sudo -n mkdir -p /var/cache/nginx/frl && sudo -n chown www-data:www-data /var/cache/nginx/frl
# 2 Go swap file (the VPS had none): a burst of memory on any site slows down instead of being killed.
if [ -z "$(swapon --show --noheadings)" ] && [ ! -e /swapfile ]; then
  sudo -n fallocate -l 2G /swapfile && sudo -n chmod 600 /swapfile && sudo -n mkswap -q /swapfile && sudo -n swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo -n tee -a /etc/fstab > /dev/null
fi
printf 'vm.swappiness = 10\nnet.ipv4.tcp_max_syn_backlog = 4096\n' | sudo -n tee /etc/sysctl.d/90-francerouelibre.conf > /dev/null
sudo -n sysctl -q -p /etc/sysctl.d/90-francerouelibre.conf
echo "swap: $(swapon --show --noheadings | awk '{print $3}' | head -1) · RAM free: $(free -m | awk '/Mem:/{print $7}') Mo"

echo "== nginx (http)"
if ! sudo -n test -f "$CERT"; then apply_conf 0; fi

echo "== certificate"
if sudo -n test -f "$CERT"; then
  echo "present"; sudo -n certbot certificates --cert-name francerouelibre.fr 2>/dev/null | grep -E "Domains|Expiry" || true
elif [ -n "$PUBLIC" ] && [ "$APEX" = "$PUBLIC" ] && [ "$WWW" = "$PUBLIC" ]; then
  sudo -n certbot certonly --webroot -w "$DIR/dist" -d francerouelibre.fr -d www.francerouelibre.fr --cert-name francerouelibre.fr --non-interactive --agree-tos --keep-until-expiring
else
  echo "DNS does not point to this VPS yet: HTTP only for now, run deploy again once it does"
fi

if sudo -n test -f "$CERT"; then
  echo "== nginx (https)"; apply_conf 1
fi

echo "== warm-up (home page files read once, so the first visitors are served from memory)"
cat "$WEB"/*.gz "$WEB"/vendor/*.gz "$WEB"/data/web/*.gz "$WEB"/data/*.gz > /dev/null 2>&1 || true

echo "== live check"
for u in http://francerouelibre.fr/ http://www.francerouelibre.fr/ https://www.francerouelibre.fr/ https://francerouelibre.fr/ https://francerouelibre.fr/data/search/meta.json; do
  printf '%s  %s\n' "$(curl -s -o /dev/null -w '%{http_code} %{size_download}B -> %{redirect_url}' --max-time 10 "$u")" "$u"
done
printf 'API: %s\n' "$(curl -s --max-time 20 'https://francerouelibre.fr/api/search?q=mise%20en%20place' | head -c 120)"
printf 'IPv4 %s · IPv6 %s · range request on the search index: %s\n' \
  "$(curl -4 -s -o /dev/null -w '%{http_code}' --max-time 10 https://francerouelibre.fr/)" \
  "$(curl -6 -s -o /dev/null -w '%{http_code}' --max-time 10 https://francerouelibre.fr/ || echo none)" \
  "$(curl -s -o /dev/null -w '%{http_code}' -r 0-15 --max-time 10 https://francerouelibre.fr/data/search/db/frl-search.sqlite3.000)"
