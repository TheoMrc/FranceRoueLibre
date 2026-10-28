# francerouelibre.fr on this VPS: static site served by nginx from /var/www/francerouelibre-web.
# 1. clone or update the GitHub repo in /var/www/francerouelibre (shallow: only the current version, to save disk),
#    then copy dist/ to the served folder with rsync: only changed files are written, each one to a temporary name then
#    renamed at the end, so visitors never read a half-written file (the 600 Mo search index above all)
# 2. Let's Encrypt certificate once the DNS points here (webroot, nginx keeps running)
# 3. nginx vhost (HTTP only until the certificate exists, then HTTPS with http and www redirected to https://francerouelibre.fr)
# 4. nginx -t, reload, live check
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
echo "== publish (only changed files, swapped at the end)"
command -v rsync >/dev/null || sudo -n apt-get install -y -q rsync
[ -d "$WEB" ] || { sudo -n mkdir -p "$WEB" && sudo -n chown "$ME":"$ME" "$WEB"; }
rsync -a --checksum --delete --delay-updates --chmod=Da+rx,Fa+r --itemize-changes "$DIR/dist/" "$WEB/" | { grep -v '^\.' || true; } | awk 'NR<=20; END {print NR " changed"}'

write_conf() {
  local https=$1
  {
    echo "# francerouelibre.fr – written by deploy/vps.sh (FranceRoueLibre repo), static files from $WEB"
    echo "limit_req_zone \$binary_remote_addr zone=frl_api:10m rate=5r/s;"
    if [ "$https" = 1 ]; then
      cat <<'NGX'
server {
    listen 80; listen [::]:80;
    server_name francerouelibre.fr www.francerouelibre.fr;
    location /.well-known/acme-challenge/ { root /var/www/francerouelibre/dist; }
    location / { return 301 https://francerouelibre.fr$request_uri; }
}
server {
    listen 443 ssl; listen [::]:443 ssl;
    server_name www.francerouelibre.fr;
    ssl_certificate     /etc/letsencrypt/live/francerouelibre.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/francerouelibre.fr/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;
    return 301 https://francerouelibre.fr$request_uri;
}
server {
    listen 443 ssl; listen [::]:443 ssl;
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
    index index.html;
    charset utf-8;
    gzip on; gzip_vary on; gzip_proxied any; gzip_comp_level 6; gzip_min_length 512;
    gzip_types text/plain text/css application/javascript text/javascript application/json application/geo+json image/svg+xml application/wasm;
    location / { try_files $uri $uri/ =404; expires 10m; }
    # Let's Encrypt (^~ wins over the dotfile rule below)
    location ^~ /.well-known/acme-challenge/ { root /var/www/francerouelibre/dist; default_type text/plain; }
    # Search index: read by HTTP range requests (nginx serves ranges natively); never gzip these
    location /data/search/db/ { gzip off; add_header Cache-Control "no-cache" always; add_header Strict-Transport-Security "max-age=31536000" always; }
    location ~ \.geojson$ { default_type application/json; expires 10m; }
    # Search API (server/search_api.py, systemd unit francerouelibre-search)
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
sudo -n systemctl restart francerouelibre-search
curl -s --retry 10 --retry-connrefused --retry-delay 1 --max-time 30 http://127.0.0.1:8017/api/health; echo
sudo -n systemctl --no-pager --lines=3 status francerouelibre-search | grep -E "Active|Memory|columns|NumPy|CPU"

echo "== dns"
PUBLIC=$(curl -4 -s --max-time 5 https://ifconfig.me || true)
APEX=$(getent ahostsv4 francerouelibre.fr | awk 'NR==1{print $1}' || true)
WWW=$(getent ahostsv4 www.francerouelibre.fr | awk 'NR==1{print $1}' || true)
echo "VPS $PUBLIC · francerouelibre.fr -> ${APEX:-?} · www -> ${WWW:-?}"

echo "== nginx (http)"
if ! sudo -n test -f "$CERT"; then write_conf 0; sudo -n nginx -t && sudo -n systemctl reload nginx; fi

echo "== certificate"
if sudo -n test -f "$CERT"; then
  echo "present"; sudo -n certbot certificates --cert-name francerouelibre.fr 2>/dev/null | grep -E "Domains|Expiry" || true
elif [ -n "$PUBLIC" ] && [ "$APEX" = "$PUBLIC" ] && [ "$WWW" = "$PUBLIC" ]; then
  sudo -n certbot certonly --webroot -w "$DIR/dist" -d francerouelibre.fr -d www.francerouelibre.fr --cert-name francerouelibre.fr --non-interactive --agree-tos --keep-until-expiring
else
  echo "DNS does not point to this VPS yet: HTTP only for now, run deploy again once it does"
fi

if sudo -n test -f "$CERT"; then
  echo "== nginx (https)"; write_conf 1; sudo -n nginx -t && sudo -n systemctl reload nginx
fi

echo "== live check"
for u in http://francerouelibre.fr/ http://www.francerouelibre.fr/ https://www.francerouelibre.fr/ https://francerouelibre.fr/ https://francerouelibre.fr/data/search/meta.json; do
  printf '%s  %s\n' "$(curl -s -o /dev/null -w '%{http_code} %{size_download}B -> %{redirect_url}' --max-time 10 "$u")" "$u"
done
printf 'API: %s\n' "$(curl -s --max-time 20 'https://francerouelibre.fr/api/search?q=mise%20en%20place' | head -c 120)"
printf 'IPv4 %s · IPv6 %s · range request on the search index: %s\n' \
  "$(curl -4 -s -o /dev/null -w '%{http_code}' --max-time 10 https://francerouelibre.fr/)" \
  "$(curl -6 -s -o /dev/null -w '%{http_code}' --max-time 10 https://francerouelibre.fr/ || echo none)" \
  "$(curl -s -o /dev/null -w '%{http_code}' -r 0-15 --max-time 10 https://francerouelibre.fr/data/search/db/frl-search.sqlite3.000)"
