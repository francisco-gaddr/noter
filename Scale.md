VPS med publik host eller IP

Raspberry Pi 5 bakom NAT

Direkt säker tunnel mellan dem

Ingen port forwarding i hemrouter

Minimal konfiguration

Detta är den enklaste möjliga lösningen.

Exempelsetup
- VPS publik host/IP: REPLACE_WITH_PUBLIC_HOST_OR_IP
- Raspberry Pi LAN-IP: REPLACE_WITH_PI_LAN_IP
- För Noter (detta repo): Pi kör docker-compose med en nginx-container på port 80, som servar /app och /api
- Om du exponerar en annan Docker-service direkt: byt porten i stegen (t.ex. 3000)

Målet
- Pi ska vara nåbar från internet via VPS: http://REPLACE_WITH_PUBLIC_HOST_OR_IP/app → (VPS) → (Tailscale/WireGuard) → (Pi nginx:80) → (web/backend)
- Ingen portöppning i hemrouter behövs

Viktigt
- Tailscale använder WireGuard under huven, men slipper allt manuellt nyckel/routing-strul.
- Det enda du måste göra manuellt är att godkänna två login-URL:er (VPS + Pi).

Scripts (gör så lite som möjligt manuellt)
- VPS: infra/tailscale/vps-setup.sh och infra/tailscale/vps-nginx-proxy.sh
- Pi: infra/tailscale/pi-setup.sh

Steg 1 – Installera Tailscale på VPS

Från din dator (Windows) – kopiera scripts

VPS:
scp infra/tailscale/vps-setup.sh infra/tailscale/vps-nginx-proxy.sh root@REPLACE_WITH_PUBLIC_HOST_OR_IP:/tmp/

Pi (LAN):
scp infra/tailscale/pi-setup.sh pi@REPLACE_WITH_PI_LAN_IP:/tmp/

Logga in på VPS och kör setup:

curl -fsSL https://tailscale.com/install.sh | sh

Eller (rekommenderat) kör scriptet:

ssh root@REPLACE_WITH_PUBLIC_HOST_OR_IP
chmod +x /tmp/vps-setup.sh
sudo /tmp/vps-setup.sh

Starta och logga in (på VPS):

sudo tailscale up

Du får en login-URL. Öppna den i webbläsaren och godkänn.

Verifiera:

tailscale status

Du får en IP typ:

100.x.x.x

Spara den.

Steg 2 – Installera Tailscale på Raspberry Pi

På Pi (rekommenderat via script):

ssh pi@REPLACE_WITH_PI_LAN_IP
chmod +x /tmp/pi-setup.sh
sudo /tmp/pi-setup.sh

Starta (på Pi):

sudo tailscale up

Logga in via URL.

Verifiera:

tailscale status

Nu ska du se både VPS och Pi i listan.

Steg 3 – Testa tunnel

Från VPS:

ping 100.x.x.x   # Pi:s Tailscale IP

Eller SSH:

ssh pi@100.x.x.x

Klart.

Ingen routerändring.
Ingen portöppning.
Ingen NAT-konfiguration.

Steg 4 – Exponera Docker från Pi via VPS

För Noter: proxya till Pi:s nginx på port 80 (och använd /app och /api).

På VPS: välj Pi:s Tailscale-IP (100.x.y.z)
- Kör: tailscale status
- Leta upp Pi i listan och ta dess 100.x.x.x-adress

# ÄR HÄR  _____
Installera + konfigurera nginx proxy (via script):

PI_TAILSCALE_IP=100.x.y.z APP_PORT=80 sudo -E /tmp/vps-nginx-proxy.sh

Manuell config (om du hellre vill):

server {
    listen 80;
    server_name REPLACE_WITH_PUBLIC_HOST_OR_IP;

    location / {
        proxy_pass http://100.x.y.z:80;
    }
}

Starta om nginx:

systemctl restart nginx

Nu:

Internet → VPS → Tailscale tunnel → Pi → Docker

Felsökning (vanligaste felen)
- Kan inte ens pinga Pi:s 100.x.x.x från VPS:
  - Kontrollera att båda maskinerna är inloggade: tailscale status
  - Kontrollera att tidsstämplar och klocka stämmer (NTP)
  - Kontrollera att inga hårda brandväggsregler på Pi blockar tailscale0
- Nginx svarar men får 502/504:
  - För Noter: kontrollera att Pi:s nginx svarar: curl -i http://127.0.0.1/health
  - Testa från VPS via tunneln: curl -i http://100.x.y.z/health
  - Om du proxyar en specifik port (t.ex. 3000): kontrollera att tjänsten lyssnar på 0.0.0.0, inte bara 127.0.0.1
- Kräver du HTTPS:
  - Skaffa domän och peka A-record till din publika host eller IP
  - Kör certbot på VPS (nginx-plugin) efter att HTTP fungerar

Alternativ: Ingen VPS behövs

Om du inte behöver VPS som ingress kan du exponera direkt från Pi:

sudo tailscale serve 3000

Tailscale ger dig en publik URL.

Detta är enklast tekniskt, men mer beroende av deras plattform.

Säkerhet

End to end WireGuard kryptering

Privata nycklar lämnar aldrig enheterna

Tailscale ser metadata men inte payload

Ingen port är öppen på din hemrouter

Rekommenderad minimal setup för dig

För VPS ↔ Pi och stabil ingress:

Installera Tailscale på båda

Reverse proxy på VPS

HTTPS via Let’s Encrypt

Stäng alla andra portar

Det är renaste arkitekturen med minst friktion.
