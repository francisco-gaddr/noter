#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

if ! command -v curl >/dev/null 2>&1; then
  apt-get update
  apt-get install -y curl
fi

curl -fsSL https://tailscale.com/install.sh | sh

systemctl enable --now tailscaled

echo ""
echo "Kör detta nu (på Pi) och öppna login-URL:en i webbläsaren:"
echo "  sudo tailscale up"
echo ""
echo "När du är klar, verifiera:"
echo "  tailscale status"
echo "  tailscale ip -4"
echo ""
echo "Kontrollera att din Docker-service faktiskt lyssnar på rätt port:"
echo "  sudo ss -lntp | head -n 50"
