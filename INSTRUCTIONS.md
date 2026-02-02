# Installationsguide: Säker Access via VPS och WireGuard

Denna guide beskriver hur du sätter upp en säker, krypterad tunnel mellan din VPS och Raspberry Pi med WireGuard, samt konfigurerar en Reverse Proxy med Nginx för att serva applikationen.

## Översikt
- **VPS (217.154.2.108):** Agerar gateway och terminerar HTTPS. Tunnlar trafik till Pi via WireGuard.
- **Raspberry Pi:** Kör Docker-containrar (Web, Backend, DB, Nginx) och tar emot trafik via WireGuard-tunneln.
- **Kryptering:** All trafik mellan klient och VPS är HTTPS. All trafik mellan VPS och Pi är krypterad via WireGuard.

## Steg 1: Förberedelser (Raspberry Pi)
Se till att du har senaste koden på Raspberry Pi och att du står i **rätt mapp** (roten av projektet):

```bash
cd /srv/projects/noter
git pull origin dev
```

**VIKTIGT:** Jag har tagit bort den gamla `docker-compose.yml` som låg i `noter-app`-mappen för att undvika förvirring. Du måste köra alla docker-kommandon från roten (`/srv/projects/noter`).

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

## Steg 4: Starta Applikationen (Raspberry Pi)
Starta om Docker-tjänsterna för att inkludera den nya Nginx-containern. **Det är viktigt att du kör detta från roten:**

```bash
cd /srv/projects/noter
# Städa bort gamla containrar
docker-compose down --remove-orphans

# Bygg och starta allt
docker-compose up -d --build
```

Verifiera att **5** containrar körs (inklusive `noter-nginx`):
```bash
docker ps
```
Du ska se: `noter-nginx`, `noter-web`, `noter-backend`, `noter-mongodb`, `noter-redis`.

## Steg 5: Slutför Kopplingen & Felsökning
1. När båda scripten kört klart, verifiera att tunneln är uppe.
   På VPS: `wg show` (ska visa "latest handshake" nyligen)
   På Pi: `sudo wg show`
2. Om `wg show` på Pi visar "transfer: 0 B received" betyder det att VPS:ens brandvägg blockerar trafiken.
   - Kontrollera att port **51820 UDP** är öppen hos din molnleverantör (t.ex. i deras kontrollpanel). Scriptet öppnar porten i UFW (serverns brandvägg), men molnleverantören kan ha en yttre brandvägg.

## Steg 6: HTTPS och Domän (Viktigt)
För att få "hänglås" och riktig HTTPS måste du ha ett domännamn (t.ex. `myapp.com`) som pekar på VPS:ens IP (`217.154.2.108`).

1. Peka din domäns A-record till `217.154.2.108`.
2. På VPS:en, kör Certbot för att hämta certifikat automatiskt:
   ```bash
   certbot --nginx -d din-doman.se
   ```
   Följ instruktionerna på skärmen. Certbot kommer automatiskt uppdatera Nginx-konfigurationen för HTTPS.

## Access
Nu når du applikationen via:
- **Frontend:** `http://217.154.2.108/app` (eller `https://...` om du fixat domän)
- **Backend API:** `http://217.154.2.108/api`

All trafik går nu:
Klient -> [HTTPS] -> VPS Nginx -> [WireGuard] -> Pi (Docker Nginx) -> Web/Backend
