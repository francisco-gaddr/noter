#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

PI_TAILSCALE_IP="${PI_TAILSCALE_IP:-}"
APP_PORT="${APP_PORT:-80}"
API_PORT="${API_PORT:-3001}"
SERVER_NAME="${SERVER_NAME:-_}"
NGINX_SITE_NAME="${NGINX_SITE_NAME:-pi-proxy}"
ENABLE_SELF_SIGNED_HTTPS="${ENABLE_SELF_SIGNED_HTTPS:-1}"
LE_CERT_DIR="${LE_CERT_DIR:-/etc/letsencrypt/live/${SERVER_NAME}}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://REPLACE_WITH_PUBLIC_HOST}"

if [[ -z "$PI_TAILSCALE_IP" ]]; then
  echo "Saknar PI_TAILSCALE_IP. Exempel:"
  echo "  PI_TAILSCALE_IP=100.x.y.z APP_PORT=80 sudo -E ./vps-nginx-proxy.sh"
  exit 1
fi

apt-get update
apt-get install -y nginx openssl

mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

BACKUP_DIR="/etc/nginx/sites-enabled.backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP_DIR"
shopt -s nullglob
for f in /etc/nginx/sites-enabled/*; do
  if [[ "$(basename "$f")" != "${NGINX_SITE_NAME}.conf" ]]; then
    mv "$f" "$BACKUP_DIR"/
  fi
done
shopt -u nullglob

if [[ "$ENABLE_SELF_SIGNED_HTTPS" == "1" && ! -f "${LE_CERT_DIR}/fullchain.pem" ]]; then
  mkdir -p /etc/nginx/selfsigned
  if [[ ! -f /etc/nginx/selfsigned/${NGINX_SITE_NAME}.crt || ! -f /etc/nginx/selfsigned/${NGINX_SITE_NAME}.key ]]; then
    openssl req -x509 -nodes -newkey rsa:2048 \
      -keyout /etc/nginx/selfsigned/${NGINX_SITE_NAME}.key \
      -out /etc/nginx/selfsigned/${NGINX_SITE_NAME}.crt \
      -days 3650 \
      -subj "/CN=${SERVER_NAME}"
  fi
fi

if [[ -f "${LE_CERT_DIR}/fullchain.pem" && -f "${LE_CERT_DIR}/privkey.pem" ]]; then
  CERT_PATH="${LE_CERT_DIR}/fullchain.pem"
  KEY_PATH="${LE_CERT_DIR}/privkey.pem"
else
  CERT_PATH="/etc/nginx/selfsigned/${NGINX_SITE_NAME}.crt"
  KEY_PATH="/etc/nginx/selfsigned/${NGINX_SITE_NAME}.key"
fi

cat >/etc/nginx/sites-available/${NGINX_SITE_NAME}.conf <<EOF
server {
  listen 80 default_server;
  server_name ${SERVER_NAME};
  proxy_hide_header Content-Security-Policy;
  add_header Content-Security-Policy "default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https: wss:; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline' https:; font-src 'self' https: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'" always;

  location /api/ {
    proxy_pass http://${PI_TAILSCALE_IP}:${API_PORT}/api/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /socket.io/ {
    proxy_pass http://${PI_TAILSCALE_IP}:${API_PORT}/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location / {
    proxy_pass http://${PI_TAILSCALE_IP}:${APP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF

if [[ -f "${CERT_PATH}" && -f "${KEY_PATH}" ]]; then
  cat >>/etc/nginx/sites-available/${NGINX_SITE_NAME}.conf <<EOF

server {
  listen 443 ssl http2 default_server;
  server_name ${SERVER_NAME};
  proxy_hide_header Content-Security-Policy;
  add_header Content-Security-Policy "default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https: wss:; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline' https:; font-src 'self' https: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'" always;

  ssl_certificate ${CERT_PATH};
  ssl_certificate_key ${KEY_PATH};

  location /api/ {
    proxy_pass http://${PI_TAILSCALE_IP}:${API_PORT}/api/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /socket.io/ {
    proxy_pass http://${PI_TAILSCALE_IP}:${API_PORT}/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location / {
    proxy_pass http://${PI_TAILSCALE_IP}:${APP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF
fi

rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-available/default

ln -sf /etc/nginx/sites-available/${NGINX_SITE_NAME}.conf /etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf

nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo ""
echo "Proxy uppe. Testa från din dator:"
echo "  curl -i ${PUBLIC_BASE_URL}/app"
echo "  curl -i ${PUBLIC_BASE_URL}/api/health || true"
