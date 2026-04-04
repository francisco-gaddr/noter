#!/bin/bash
set -e

echo "== WireGuard Pi Setup =="

VPS_ENDPOINT="${VPS_ENDPOINT:-REPLACE_WITH_VPS_HOST_OR_IP:51820}"

apt update
apt install -y wireguard

mkdir -p /etc/wireguard
cd /etc/wireguard

wg genkey | tee pi_private.key | wg pubkey > pi_public.key

chmod 600 *.key

cat > wg0.conf <<EOF
[Interface]
Address = 10.8.0.2/24
PrivateKey = $(cat pi_private.key)
DNS = 1.1.1.1

[Peer]
# VPS_PUBLIC_KEY_HÄR
PublicKey = REPLACE_VPS_PUBLIC_KEY
Endpoint = ${VPS_ENDPOINT}
AllowedIPs = 10.8.0.1/32
PersistentKeepalive = 25
EOF

systemctl enable wg-quick@wg0
