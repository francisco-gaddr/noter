# Public Release Commit Checklist

## Mål

Den här checklistan hjälper till att göra en publik commit eller första open source-release av monorepot utan att läcka lokala filer, kontospecifik konfiguration eller osanerad intern arbetsyta.

## Ta med

- `LICENSE`
- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`
- `SUPPORT.md`
- `.github/workflows/*` som validerar repo, web eller Electron
- `.github/ISSUE_TEMPLATE/*`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/dependabot.yml`
- `.env.example`-filer
- README-filer och runbooks som beskriver publik setup
- tester, säkerhetstester, build-readiness-skript och repo-scanners
- produktionskod som redan är verifierad via `validate:prepush`

## Granska extra noga innan commit

- ändringar i `apps/backend`, `apps/web`, `apps/mobile` och `electron-noter`
- alla nya package.json- eller configändringar
- alla nya CI-workflows
- allt som påverkar auth, sync, kryptering, lagring eller API-URL
- filer som råkar vara nya men inte länkas från README eller runbooks

## Ska aldrig följa med

- riktiga `.env`-filer
- lokala Trae-/skill-/rule-filer under `.trae/`
- lokala AI-agentfiler som `AGENTS.md`, `agent.md`, `*.agent.md`, `INSTRUCTIONS.md` och `RULES_INDEX.md`
- lokala IDE-/assistentmappar som `.vscode`, `.idea`, `.cursor`, `.windsurf`, `.continue`, `.cline`, `.roo`, `.zed`, `.fleet`, `.aider*`
- lokala miljöfiler som `.direnv`, `.envrc` och `*.code-workspace`
- kontokopplade EAS-, deploy- eller kundspecifika hemligheter

## Rekommenderad ordning före publik commit

1. Kör `git status --short`
2. Bekräfta att lokala AI-/IDE-filer bara syns som borttagna från index eller inte alls
3. Kör `cd noter-app && npm run test:repo:open-source`
4. Kör `cd noter-app && npm run validate:prepush`
5. Kör relevanta app-specifika readiness-kommandon om din ändring påverkar mobil eller Electron release
6. Läs igenom diffen för nya docs, workflows och env-exempel en sista gång

## Tumregel

Om en fil är personlig, maskinspecifik, kontokopplad, hemlig eller bara relevant för din lokala AI-/IDE-konfiguration ska den inte ligga i ett publikt open source-repo.
