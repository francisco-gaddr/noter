#!/bin/bash
set -e

echo "== WireGuard VPS Setup =="

apt update
apt install -y wireguard iptables tcpdump

mkdir -p /etc/wireguard
cd /etc/wireguard

wg genkey | tee vps_private.key | wg pubkey > vps_public.key

chmod 600 *.key

cat > wg0.conf <<EOF
[Interface]
Address = 10.8.0.1/24
ListenPort = 51820
PrivateKey = $(cat vps_private.key)

PostUp = iptables -A FORWARD -i wg0 -j ACCEPT
PostUp = iptables -A FORWARD -o wg0 -j ACCEPT
PostUp = iptables -t nat -A POSTROUTING -o ens6 -j MASQUERADE

PostDown = iptables -D FORWARD -i wg0 -j ACCEPT
PostDown = iptables -D FORWARD -o wg0 -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -o ens6 -j MASQUERADE

[Peer]
# PI_PUBLIC_KEY_HÄR
PublicKey = REPLACE_PI_PUBLIC_KEY
AllowedIPs = 10.8.0.2/32
EOF

sysctl -w net.ipv4.ip_forward=1
sysctl -w net.ipv4.conf.all.rp_filter=0
sysctl -w net.ipv4.conf.wg0.rp_filter=0

echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
echo "net.ipv4.conf.all.rp_filter=0" >> /etc/sysctl.conf
echo "net.ipv4.conf.wg0.rp_filter=0" >> /etc/sysctl.conf

systemctl enable wg-quick@wg0
