#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

PI_TAILSCALE_IP="${PI_TAILSCALE_IP:-}"
APP_PORT="${APP_PORT:-80}"
SERVER_NAME="${SERVER_NAME:-_}"
NGINX_SITE_NAME="${NGINX_SITE_NAME:-pi-proxy}"
ENABLE_SELF_SIGNED_HTTPS="${ENABLE_SELF_SIGNED_HTTPS:-1}"

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

if [[ "$ENABLE_SELF_SIGNED_HTTPS" == "1" ]]; then
  mkdir -p /etc/nginx/selfsigned
  if [[ ! -f /etc/nginx/selfsigned/${NGINX_SITE_NAME}.crt || ! -f /etc/nginx/selfsigned/${NGINX_SITE_NAME}.key ]]; then
    openssl req -x509 -nodes -newkey rsa:2048 \
      -keyout /etc/nginx/selfsigned/${NGINX_SITE_NAME}.key \
      -out /etc/nginx/selfsigned/${NGINX_SITE_NAME}.crt \
      -days 3650 \
      -subj "/CN=${SERVER_NAME}"
  fi
fi

cat >/etc/nginx/sites-available/${NGINX_SITE_NAME}.conf <<EOF
server {
  listen 80 default_server;
  server_name ${SERVER_NAME};

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

if [[ "$ENABLE_SELF_SIGNED_HTTPS" == "1" ]]; then
  cat >>/etc/nginx/sites-available/${NGINX_SITE_NAME}.conf <<EOF

server {
  listen 443 ssl http2 default_server;
  server_name ${SERVER_NAME};

  ssl_certificate /etc/nginx/selfsigned/${NGINX_SITE_NAME}.crt;
  ssl_certificate_key /etc/nginx/selfsigned/${NGINX_SITE_NAME}.key;

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
echo "  curl -i http://217.154.2.108/app"
echo "  curl -i http://217.154.2.108/api/health || true"
