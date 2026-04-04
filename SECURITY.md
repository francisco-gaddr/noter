# Security Policy

## Omfattning

Den här policyn gäller hela monorepot:

- web
- mobile
- backend
- electron-noter
- delade paket och scripts

## Rapportera sårbarheter

- Publicera inte exploaterbara detaljer i publika issues eller pull requests
- Om privat sårbarhetsrapportering är aktiverad i GitHub, använd den kanalen
- Om ingen privat kanal finns tillgänglig, kontakta repoägaren via en privat kontaktväg innan du delar detaljer offentligt
- Inkludera berörd app eller modul, reproduktionssteg, påverkan, versions-/miljöinfo och om känslig data kan exponeras

## Önskat innehåll i rapporten

- berörd yta: web, mobile, backend, electron eller package
- typ av problem: auth, dataexponering, injektion, lokallagring, IPC, secrets, supply chain eller availability
- tydliga reproduktionssteg
- förväntat resultat och faktiskt resultat
- bedömd påverkan

## Hantering

- Målet är första bekräftelse inom 5 arbetsdagar
- Bekräftade problem prioriteras efter påverkan på data, kontoåtkomst, kodexekvering och publikt utnyttjande
- Fixar kan hållas privata tills en patch eller rimlig mitigering finns

## Säker utveckling

- Kör `npm run test:repo:open-source` i `noter-app`
- Kör `npm run validate:prepush` i `noter-app`
- Kör relevanta app-specifika readiness- eller build-gates innan release
