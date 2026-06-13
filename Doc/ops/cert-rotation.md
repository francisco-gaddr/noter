# Code-signing certificate rotation

_Senast uppdaterat: 2026-05-14 · Målgrupp: release-engineering, security_

Cert-roteringar är **planerade händelser** — Apple Developer ID går ut efter
5 år, Azure Trusted Signing certificate profiles snurrar oftare. Den här
runbooken körs både planerat (innan utgång) och vid läckage.

## Förberedelser (kvartalsvis)

1. **Inventera** aktiva certs:
   - macOS: `security find-identity -v -p codesigning`
   - Windows: `gci Cert:\CurrentUser\My`
   - Notarisering: kolla `xcrun notarytool history`
2. Kolla utgångsdatum. Sätt kalender-påminnelse 90 dagar före.
3. Verifiera att `NOTER_ASAR_SHA256` är dokumenterad för sista signerade build.

## macOS — Apple Developer ID

### Planerad rotation

1. Generera ny **Developer ID Application** certifikat i developer.apple.com.
2. Ladda ner och dubbelklicka för installation i Keychain.
3. Notera `Team ID` (om oförändrat behövs inget mer).
4. Sätt `APPLE_TEAM_ID` i CI-secrets om det ändrats.
5. Kör en testbuild via `npm run build:mac:arm64` lokalt:
   ```
   codesign -dvv dist-electron-build/mac-arm64/Noter.app
   xcrun notarytool submit ... --wait
   ```
6. Verifiera att produktion-installern *fortfarande* matchar
   `NOTER_PINNED_CERT_FINGERPRINTS`. Om inte: bumpa env och pusha en ny
   minor release **före** den gamla certifikatet går ut.

### Brådskande rotation (läckt cert)

1. **Revokera omedelbart** via Apple Developer-portalen.
2. Skapa nytt cert (samma steg som ovan).
3. Bumpa Noter-version (`patch`) och cut en release med nya signaturen.
4. Pusha en force-update via update-feed med
   `mandatoryUpdate: true`-flagga i `latest.yml`.
5. Kör postmortem (`Doc/incidents/`).

## Windows — Azure Trusted Signing

### Planerad rotation av certificate profile

1. I Azure Portal: Trusted Signing → Certificate profiles → "Create new
   version". Bekräfta `subjectName`.
2. Uppdatera CI-secrets:
   - `AZURE_TRUSTED_SIGNING_PROFILE` — nya profilens namn.
   - `AZURE_TRUSTED_SIGNING_ENDPOINT` — oförändrad.
3. Bygg testbinär: `npm run build` → kontrollera signaturen med
   `signtool verify /pa /v Noter-Setup.exe`.
4. Squirrel/electron-updater validerar nya signatur mot publicerad
   `latest.yml` — om `publisherName` matchar trustar uppdateraren det.

### Brådskande rotation

1. Pausa publisher-konto i Azure (förhindrar fortsatta signaturer).
2. Skapa ny certificate profile.
3. Re-sign senaste good-known build med nya profilen och pusha.
4. För installerade klienter: lägg `publisherNameOverride` i `latest.yml`
   så updater accepterar nya signaturen för befintliga installation.

## Pinning-rotation i Electron-klienten

När backend-cert roterar:

1. Hämta nya cert-fingerprint (`openssl s_client -connect api.noter.app:443
   -servername api.noter.app | openssl x509 -fingerprint -sha256 -noout`).
2. Lägg in i `NOTER_PINNED_CERT_FINGERPRINTS` *före* utrullning så att
   både gamla och nya fingerprints accepteras under övergångsfönstret.
3. Efter ~14 dagar — ta bort den gamla.
4. Push en patch-release.

## CI-konfig (engångs)

GitHub Actions:
```yaml
secrets:
  APPLE_TEAM_ID:                  # Apple Developer Team ID
  APPLE_NOTARIZATION_USERNAME:    # Apple ID för notarisering
  APPLE_NOTARIZATION_PASSWORD:    # App-specific password
  AZURE_TRUSTED_SIGNING_ENDPOINT:
  AZURE_TRUSTED_SIGNING_PROFILE:
  AZURE_TRUSTED_SIGNING_ACCOUNT:
  AZURE_TENANT_ID:
  AZURE_CLIENT_ID:
  AZURE_CLIENT_SECRET:
```

## Verifieringscheck efter rotation

- [ ] `codesign --verify --deep --strict --verbose=2 Noter.app` exit 0
- [ ] `xcrun notarytool history` visar senaste submission som "Accepted"
- [ ] `signtool verify /pa Noter-Setup.exe` exit 0
- [ ] `electron-updater` lyckas hämta + applicera senaste release på en
       testmaskin med gamla version installerad
- [ ] `NOTER_ASAR_SHA256` uppdaterad i en deploy-config; gamla värdet
       hålls 30 dagar för rollback
- [ ] Postmortem (om brådskande) länkad i `Doc/incidents/`
