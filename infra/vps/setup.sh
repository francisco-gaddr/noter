#!/bin/bash
set -e

# Configuration
WG_INTERFACE="wg0"
WG_PORT="51820"
WG_ADDRESS="10.8.0.1/24"
PI_PEER_IP="10.8.0.2"

# Ensure script is run as root
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root"
  exit 1
fi

echo "Updating system..."
apt-get update && apt-get upgrade -y

echo "Installing WireGuard, Nginx, Certbot..."
apt-get install -y wireguard nginx certbot python3-certbot-nginx ufw net-tools

echo "Enabling IP Forwarding..."
sed -i 's/#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf
sysctl -p

echo "Generating WireGuard Keys..."
umask 077
mkdir -p /etc/wireguard
if [ ! -f /etc/wireguard/privatekey ]; then
    wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey
fi
PRIVATE_KEY=$(cat /etc/wireguard/privatekey)
PUBLIC_KEY=$(cat /etc/wireguard/publickey)

echo "------------------------------------------------"
echo "VPS Public Key: $PUBLIC_KEY"
echo "------------------------------------------------"
echo "Please enter the Raspberry Pi's Public Key (Run infra/pi/setup.sh on Pi to get it):"
read PI_PUBLIC_KEY

echo "Creating WireGuard Config..."
cat > /etc/wireguard/$WG_INTERFACE.conf <<EOF
[Interface]
Address = $WG_ADDRESS
SaveConfig = true
ListenPort = $WG_PORT
PrivateKey = $PRIVATE_KEY
# Allow forwarding
PostUp = ufw route allow in on $WG_INTERFACE out on eth0
PostUp = iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = ufw route delete allow in on $WG_INTERFACE out on eth0
PostDown = iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

[Peer]
PublicKey = $PI_PUBLIC_KEY
AllowedIPs = $PI_PEER_IP/32
EOF

echo "Configuring Firewall (UFW)..."
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow $WG_PORT/udp
# Explicitly allow forwarding for WireGuard
ufw route allow in on wg0 out on $PUB_INTERFACE
ufw route allow in on $PUB_INTERFACE out on wg0
echo "y" | ufw enable

echo "Starting WireGuard..."
systemctl enable wg-quick@$WG_INTERFACE
systemctl restart wg-quick@$WG_INTERFACE

echo "Configuring Nginx..."
# Remove default if exists
rm -f /etc/nginx/sites-enabled/default

cat > /etc/nginx/sites-available/noter <<EOF
server {
    listen 80;
    server_name _; 

    # Frontend
    location /app {
        proxy_pass http://$PI_PEER_IP:80/app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Timeout settings for debugging
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Backend
    location /api {
        proxy_pass http://$PI_PEER_IP:80/api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    
    location = / {
        return 301 /app;
    }
}
EOF

ln -sf /etc/nginx/sites-available/noter /etc/nginx/sites-enabled/
systemctl restart nginx

echo "------------------------------------------------"
echo "Setup Complete!"
echo "------------------------------------------------"
echo "DIAGNOSTICS:"
echo "1. WireGuard Status:"
wg show
echo ""
echo "2. Nginx Status:"
systemctl is-active nginx
echo ""
echo "3. Firewall Status:"
ufw status verbose
echo ""
echo "IMPORTANT: Ensure your Cloud Provider Firewall allows UDP port $WG_PORT and TCP 80/443!"
