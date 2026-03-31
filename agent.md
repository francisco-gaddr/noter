# agent.md

Detta dokument är agentens snabbstyrning för att snabbt hitta rätt regler, rätt verifiering och rätt dokument i workspace.

## Läsordning

- Samlad indexfil: [RULES_INDEX.md](file:///f:/Tech/Projekt/Noter/RULES_INDEX.md)
- Global policy: [AGENTS.md](file:///f:/Tech/Projekt/Noter/AGENTS.md)
- Projektprompt: [project_prompt.md](file:///f:/Tech/Projekt/Noter/noter-app/.trae/rules/project_prompt.md)
- Projektregler: [project_rules.md](file:///f:/Tech/Projekt/Noter/noter-app/.trae/rules/project_rules.md)
- Engineering playbook: [engineering_playbook.md](file:///f:/Tech/Projekt/Noter/noter-app/.trae/rules/engineering_playbook.md)
- Drift- och infra-guide: [INSTRUCTIONS.md](file:///f:/Tech/Projekt/Noter/INSTRUCTIONS.md)

## Beslutsmatris

- Om uppgiften gäller generella agentregler, konflikter mellan dokument eller leveranskriterier: börja i [AGENTS.md](file:///f:/Tech/Projekt/Noter/AGENTS.md).
- Om uppgiften gäller hur agenten ska resonera, prioritera, verifiera och rapportera: läs [project_prompt.md](file:///f:/Tech/Projekt/Noter/noter-app/.trae/rules/project_prompt.md).
- Om uppgiften gäller konkreta tekniska regler för säkerhet, tester, robusthet, mobil eller Electron: läs [project_rules.md](file:///f:/Tech/Projekt/Noter/noter-app/.trae/rules/project_rules.md).
- Om uppgiften gäller vilka kommandon, gates och leveransbevis som måste köras: läs [engineering_playbook.md](file:///f:/Tech/Projekt/Noter/noter-app/.trae/rules/engineering_playbook.md).
- Om uppgiften gäller VPS, WireGuard, deploy eller nätverksdrift: läs [INSTRUCTIONS.md](file:///f:/Tech/Projekt/Noter/INSTRUCTIONS.md).

## Operativ policy

- Arbeta alltid i den aktiva arbetsytan först: `noter-app/`, `electron-noter/` och `Doc/`.
- Behandla parallella eller äldre katalogträd som referensmaterial om inte uppgiften uttryckligen nämner dem.
- Håll säkerhet, verifiering och dokumentation i samma leverans när beteende eller regler ändras.
- Välj den mest specifika regeln om flera dokument överlappar, men låt [AGENTS.md](file:///f:/Tech/Projekt/Noter/AGENTS.md) vinna vid konflikt.
- När osäkerhet finns mellan snabb väg och robust väg ska robust väg prioriteras.
- När osäkerhet finns mellan enkel implementation och responsiv UX ska agenten välja vägen som minskar blockerande arbete på kritisk UI-path.

## Prioriterad agentpolicy

- Säkerställ alltid kryptering at rest och in transit för notes, tasks, AI-inställningar och credentials.
- Bevisa EAS APK-readiness med readiness-script, valideringsmatris och faktisk EAS-buildstatus när release är i scope.
- Håll mobilens task- och notes-flöden omedelbara i UI även när lokal persistens, sync och reminder-logik körs.
- Leta aktivt efter dubbel startup-laddning, seriell I/O, onödiga full-rerenders och långa save-loopar i både mobil och Electron/web innan nya optimeringar avslutas.
- Säkerställ att AI-native runtime skiljer korrekt mellan Expo Go, saknat filsystem, saknat zip-stöd och saknad MLC-modul i EAS-builds.
- Säkerställ att upplåsta låsta anteckningar dekrypteras för visning men aldrig faller tillbaka till att visa rå ciphertext.
- Säkerställ att AI-chattens lokala datalager hanterar sortering, senaste aktivitet och projektkopplingar utifrån dekrypterade värden, inte krypterad SQL-ordning.
- Uppdatera dokumentation och testmatris i samma leverans när säkerhets-, build- eller agentflöden ändras.

## Standardflöde för agenter

- Kartlägg berörda filer, appar, scripts och rules innan ändringar påbörjas.
- Identifiera vilka verifieringsgates som gäller för uppgiften.
- Gör ändringar i små steg och verifiera löpande.
- Uppdatera dokumentation samtidigt som regler, flöden eller leveranskrav ändras.
- Avsluta med tydlig redovisning av ändringar, verifiering och kvarvarande risker.

## Skills som ska användas proaktivt

- Release readiness: [release-readiness-gate](file:///f:/Tech/Projekt/Noter/.trae/skills/release-readiness-gate/SKILL.md)
- Säkerhet at rest: [security-at-rest-auditor](file:///f:/Tech/Projekt/Noter/.trae/skills/security-at-rest-auditor/SKILL.md)
- Mobil AI-verifiering: [mobile-ai-e2e-verifier](file:///f:/Tech/Projekt/Noter/noter-app/.trae/skills/mobile-ai-e2e-verifier/SKILL.md)
- Mobil lokal säkerhet: [noter-local-security-hardening](file:///f:/Tech/Projekt/Noter/noter-app/.trae/skills/noter-local-security-hardening/SKILL.md)

## Snabbregel

- Om du är osäker på vilket dokument som gäller, använd [AGENTS.md](file:///f:/Tech/Projekt/Noter/AGENTS.md) för konfliktlösning, [project_rules.md](file:///f:/Tech/Projekt/Noter/noter-app/.trae/rules/project_rules.md) för teknisk precision och [engineering_playbook.md](file:///f:/Tech/Projekt/Noter/noter-app/.trae/rules/engineering_playbook.md) för faktisk verifiering.
