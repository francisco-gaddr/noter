# agent.md

Detta workspace använder följande agentkarta:

- Primär arbetsregel: [AGENTS.md](file:///f:/Tech/Projekt/Noter/AGENTS.md)
- Projektprompt: [project_prompt.md](file:///f:/Tech/Projekt/Noter/noter-app/.trae/rules/project_prompt.md)
- Projektregler: [project_rules.md](file:///f:/Tech/Projekt/Noter/noter-app/.trae/rules/project_rules.md)
- Engineering playbook: [engineering_playbook.md](file:///f:/Tech/Projekt/Noter/noter-app/.trae/rules/engineering_playbook.md)

## Prioriterad agentpolicy

- Säkerställ alltid kryptering at rest och in transit för notes, tasks, AI-inställningar och credentials.
- Bevisa EAS APK-readiness med readiness-script, full valideringsmatris och faktisk EAS-buildstatus när release är i scope.
- Håll mobilens task- och notes-flöden omedelbara i UI även när lokal persistens, sync och reminder-logik körs.
- Säkerställ att AI-native runtime skiljer korrekt mellan Expo Go, saknat filsystem, saknat zip-stöd och saknad MLC-modul i EAS-builds.
- Säkerställ att upplåsta låsta anteckningar dekrypteras för visning men aldrig faller tillbaka till att visa rå ciphertext.
- Uppdatera dokumentation och testmatris i samma leverans när säkerhets-, build- eller agentflöden ändras.

## Skills som ska användas proaktivt

- Release readiness: [release-readiness-gate](file:///f:/Tech/Projekt/Noter/.trae/skills/release-readiness-gate/SKILL.md)
- Säkerhet at rest: [security-at-rest-auditor](file:///f:/Tech/Projekt/Noter/.trae/skills/security-at-rest-auditor/SKILL.md)
- Mobil AI-verifiering: [mobile-ai-e2e-verifier](file:///f:/Tech/Projekt/Noter/noter-app/.trae/skills/mobile-ai-e2e-verifier/SKILL.md)
- Mobil lokal säkerhet: [noter-local-security-hardening](file:///f:/Tech/Projekt/Noter/noter-app/.trae/skills/noter-local-security-hardening/SKILL.md)
