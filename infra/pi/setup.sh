#!/bin/bash
set -e

# Configuration
WG_INTERFACE="wg0"
VPS_ENDPOINT_IP="217.154.2.108"
VPS_ENDPOINT_PORT="51820"
WG_ADDRESS="10.8.0.2/24"

echo "Updating system..."
sudo apt-get update && sudo apt-get upgrade -y

echo "Installing WireGuard..."
sudo apt-get install -y wireguard

echo "Generating WireGuard Keys..."
umask 077
sudo mkdir -p /etc/wireguard
# Generate only if not exists to preserve keys on re-run
if [ ! -f /etc/wireguard/privatekey ]; then
    wg genkey | sudo tee /etc/wireguard/privatekey | wg pubkey | sudo tee /etc/wireguard/publickey
fi

PRIVATE_KEY=$(sudo cat /etc/wireguard/privatekey)
PUBLIC_KEY=$(sudo cat /etc/wireguard/publickey)

echo "------------------------------------------------"
echo "Pi Public Key: $PUBLIC_KEY"
echo "------------------------------------------------"
echo "Please enter the VPS Public Key (Run infra/vps/setup.sh on VPS to get it):"
read VPS_PUBLIC_KEY

echo "Creating WireGuard Config..."
sudo bash -c "cat > /etc/wireguard/$WG_INTERFACE.conf <<EOF
[Interface]
Address = $WG_ADDRESS
PrivateKey = $PRIVATE_KEY

[Peer]
PublicKey = $VPS_PUBLIC_KEY
Endpoint = $VPS_ENDPOINT_IP:$VPS_ENDPOINT_PORT
AllowedIPs = 10.8.0.1/32
PersistentKeepalive = 25
EOF"

echo "Starting WireGuard..."
sudo systemctl enable wg-quick@$WG_INTERFACE
sudo systemctl start wg-quick@$WG_INTERFACE

echo "------------------------------------------------"
echo "Setup Complete!"
echo "WireGuard Status:"
sudo wg show
echo "------------------------------------------------"
echo "Now run 'docker-compose up -d --build' to start the application stack."
