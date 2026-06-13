# Noter — WCAG 2.2 audit-runbook

_Senast uppdaterat: 2026-05-14 · Målgrupp: design + frontend_

Den här filen samlar de tester och manuella checkar vi kör halvårsvis för
att hålla WCAG 2.2 AA. Web är kontinuerligt täckt av `axe-core`; iOS och
Android kräver native verktyg.

## Web (`apps/web`)

Automatiserat:

- `axe-core/react` i development loggar issues i konsolen (vi bryter inte
  builden — bara dev-fönstret).
- Cypress `cypress-axe` integration kör i `quality-gate.yml` mot
  `@critical+@a11y`-taggade tester.
- Lighthouse accessibility-score budget = 0.95 (definierad i
  `.lighthouserc.json`).

Manuellt halvårsvis:

- [ ] Tab-genom alla huvudvyer — fokus-ring synlig?
- [ ] Skärmläsare (VoiceOver Mac / NVDA Win) — varje knapp annonserar roll och state?
- [ ] Kontrast i båda teman (≥ 4.5:1 normal text, ≥ 3:1 large text)
- [ ] `prefers-reduced-motion` respekteras — verifiera View Transitions
- [ ] Inga tomma `<a>` eller `<button>` utan accessible name

## iOS

Automatiserat:

- Xcode **Accessibility Inspector** i UI-testkörning.
- `detox`-tester med `accessibilityLabel`-kontroll.

Manuellt:

- [ ] VoiceOver: kontrollera att alla `Pressable` har `accessibilityLabel`
- [ ] Dynamic Type (Settings → Display & Brightness → Text Size) — layout
      ska skala upp till `accessibilityExtraExtraExtraLarge`
- [ ] Reduce Motion — Reanimated-animationer ska respektera
      `AccessibilityInfo.isReduceMotionEnabled()`
- [ ] Full Keyboard Access (iPad) — tab-flöde, focus highlights
- [ ] Smart Invert: undvik invertering på bilder genom `accessibilityIgnoresInvertColors`

## Android

Automatiserat:

- **Accessibility Scanner** (Google Play) — kör mot debug-build.
- `eslint-plugin-react-native-a11y` (vi har `.eslintrc.a11y.cjs`).
- `axe-android` i Detox e2e.

Manuellt:

- [ ] TalkBack — annonserar varje knapp korrekt?
- [ ] Material You font-scale max
- [ ] Switch Access — kan användaren navigera utan touch?
- [ ] Dark mode — kontrast (4.5:1 på små texter, 3:1 på stora/icon)
- [ ] `android:importantForAccessibility` korrekt på beslutsnoder

## Allmänna kriterier vi specifikt testar (WCAG 2.2)

| Riktlinje | Kriterier | Var vi täcker |
|-----------|-----------|---------------|
| 1.4.10 Reflow | Inga horizontal scrollbars vid 320 px / 200 % zoom | Manual + Lighthouse |
| 1.4.11 Non-text Contrast | UI-element 3:1 | axe + Accessibility Scanner |
| 2.4.7 Focus Visible | Synlig fokus-indikator | `noter-focus-ring` CSS-class |
| 2.5.7 Dragging Movements | Alla drag-gester har alternativ | Manual: drag-to-reorder har long-press-menu |
| 2.5.8 Target Size | ≥ 24x24 CSS pixels | manuellt + Lighthouse |
| 3.2.6 Consistent Help | Help link i samma position på alla vyer | Manual |
| 3.3.7 Redundant Entry | Inte tvinga reinput av info | Manual: lösenord aldrig återintervjuad |
| 3.3.8 Accessible Authentication | Lösenord ska kunna pasta:s in | Verifierat: `secureTextEntry` tillåter paste |

## Audit-cycle

1. Q1 + Q3 (april + oktober): kör hela checklistan; öppna issues för varje
   fail.
2. Issues fixas till nästa minor release.
3. Resultat tagas i `Doc/incidents/`-loggat formula om någon SEV2-fail
   hittas.

## Verktyg-cheat-sheet

```
# Web
npm --prefix noter-app/apps/web run dev     # axe-core loggar i devtools

# iOS
# Open Xcode → Window → Accessibility Inspector
# Run app, click target → audit current view

# Android
# Install "Accessibility Scanner" from Play Store
# Long-press FAB → analyse current screen
```
