# Installationsguide: Säker Access via VPS och WireGuard

Denna guide beskriver hur du sätter upp en säker, krypterad tunnel mellan din VPS och Raspberry Pi med WireGuard, samt konfigurerar en Reverse Proxy med Nginx för att serva applikationen.

## Översikt
- **VPS (217.154.2.108):** Agerar gateway och terminerar HTTPS. Tunnlar trafik till Pi via WireGuard.
- **Raspberry Pi:** Kör Docker-containrar (Web, Backend, DB, Nginx) och tar emot trafik via WireGuard-tunneln.
- **Kryptering:** All trafik mellan klient och VPS är HTTPS. All trafik mellan VPS och Pi är krypterad via WireGuard.

## Steg 1: Förberedelser
Se till att du har senaste koden på Raspberry Pi:
```bash
cd /srv/projects/noter
git pull origin dev
```

## Steg 2: Konfigurera VPS
1. SSH:a in på din VPS: `ssh root@217.154.2.108`
2. Ladda upp och kör installationsscriptet `infra/vps/setup.sh`. Du kan kopiera innehållet eller använda `scp`.
   
   **Alternativ (Kopiera & Klistra in):**
   Öppna filen `infra/vps/setup.sh` lokalt, kopiera innehållet.
   På VPS:
   ```bash
   nano setup.sh
   # Klistra in innehållet, spara (Ctrl+O) och stäng (Ctrl+X)
   chmod +x setup.sh
   ./setup.sh
   ```
3. Scriptet kommer att visa **VPS Public Key**. Spara denna!
4. Scriptet kommer att be om **Raspberry Pi Public Key**. Lämna terminalen öppen eller vänta med att fylla i detta tills du gjort Steg 3.

## Steg 3: Konfigurera Raspberry Pi
1. SSH:a in på din Raspberry Pi: `ssh realdini@192.168.50.16`
2. Gå till projektmappen: `cd /srv/projects/noter`
3. Kör installationsscriptet:
   ```bash
   chmod +x infra/pi/setup.sh
   ./infra/pi/setup.sh
   ```
4. Scriptet kommer att visa **Pi Public Key**. Kopiera denna och klistra in i VPS-terminalen om den väntar, eller uppdatera VPS-konfigurationen manuellt.
5. Scriptet kommer be om **VPS Public Key**. Klistra in nyckeln du fick från VPS:en i Steg 2.

## Steg 4: Slutför Kopplingen
1. När båda scripten kört klart, verifiera att tunneln är uppe.
   På VPS: `wg show` (ska visa "latest handshake" nyligen)
   På Pi: `sudo wg show`
2. Starta om Docker-tjänsterna på Raspberry Pi för att inkludera den nya Nginx-containern:
   ```bash
   docker-compose down
   docker-compose up -d --build
   ```

## Steg 5: HTTPS och Domän (Viktigt)
För att få "hänglås" och riktig HTTPS måste du ha ett domännamn (t.ex. `myapp.com`) som pekar på VPS:ens IP (`217.154.2.108`).

1. Peka din domäns A-record till `217.154.2.108`.
2. På VPS:en, kör Certbot för att hämta certifikat automatiskt:
   ```bash
   certbot --nginx -d din-doman.se
   ```
   Följ instruktionerna på skärmen. Certbot kommer automatiskt uppdatera Nginx-konfigurationen för HTTPS.

## Access
Nu når du applikationen via:
- **Frontend:** `https://din-doman.se/app` (eller `http://217.154.2.108/app` om ingen domän)
- **Backend API:** `https://din-doman.se/api`

All trafik går nu:
Klient -> [HTTPS] -> VPS Nginx -> [WireGuard] -> Pi (Docker Nginx) -> Web/Backend
