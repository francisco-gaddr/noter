# Improvements & Todo List

## High Priority (Critical)

- [x] **Web React-DnD Fix**: Refactor `SidebarTree.tsx` to use `TreeNode.tsx` and proper types (`DropTargetMonitor`).
  - *Note*: Addressed recurring HMR/module factory error. If error persists, a full server restart is recommended.
- [x] **Mobile Syntax Error**: Fix JSX syntax error in `task/[id].tsx` (missing closing tag).
- [x] **Mobile Monorepo Config**: Fixed `@repo/shared` resolution error by adding `babel-plugin-module-resolver` and updating `metro.config.js`.
- [x] **Startup Stability**: Fixed "Cannot find module 'bson'" error by ensuring dependencies are correctly installed.
- [x] **Web Socket Stability**: Added network event listeners in `useStore.ts` to handle connection errors gracefully.
- [x] **Mobile Startup Time**: Optimized startup by deferring socket connection and network listeners using `InteractionManager`.
- [x] **Web Error Boundary**: Added `SidebarErrorBoundary` to prevent sidebar crashes from breaking the whole app.
- [x] **Mobile Settings Crash**: Fix `SettingsScreen` width reference error.
- [x] **Session Expiry UX**: On 401, clear token and redirect to login.
- [x] **User-Scoped Realtime**: Scope Socket.IO events per user room.
- [x] **Mobile Task UX**: Autofocus title + quick date presets (Idag/Imorgon/Slutet av veckan).

## Performance & Optimization

- [x] **Mobile Animations**: Migrate to `react-native-reanimated` for smoother transitions (implemented in `NoteTree.tsx`).
- [x] **Bundle Size**: Analyzed mobile bundle size (~6.53 MB Hermes bytecode).
  - *Action*: Optimized imports (e.g., `lodash`).
  - *Status*: Reasonable size for current feature set.
- [x] **React Compiler**: Enabled React Compiler (experimental) in `next.config.js` and installed babel plugin.

## Code Quality & Maintenance

- [x] **Types**: Eliminate `any` usage in TypeScript files (search for `as any` and replace with proper types).
  - *Status*: Fixed `SidebarTree.tsx`, `useStore.ts`, and `api.ts`.
  - *Pending*: Remaining usages in non-critical components.
- [x] **Web Unit Tests**: Add unit tests for critical components (e.g., `SidebarTree`, `NoteEditor`).
  - *Status*: Added tests for `SidebarTree` and `SidebarErrorBoundary`.
- [ ] **Integration Tests**: Add integration tests for key flows.
- [ ] **Auth Regression Tests**: Add tests for session expiry redirect and logout.

## Security & Accessibility

- [x] **Web Accessibility**: Added skip link, main content ID, and ARIA labels.
- [x] **CSRF Protection**: Verified token-based authentication (Bearer token) usage, which mitigates CSRF. Ensure strict `SameSite` cookie policies if cookies are used in future.

## New Suggestions

- [ ] **E2E Testing**: Implement Maestro or Detox for mobile end-to-end testing.
- [ ] **CI/CD Pipeline**: Set up GitHub Actions for automated linting, testing, and building.
- [ ] **Lockfile Gate**: Add CI step running `npm ci` to validate lockfile sync.
- [ ] **Error Tracking**: Integrate Sentry for real-time error monitoring in production.
- [ ] **Internationalization**: Complete translation coverage for all strings (currently partial).
- [ ] **Theme Consistency**: Audit dark mode colors across mobile and web for consistency.
- [ ] **Offline Sync Conflict Resolution**: Implement more robust conflict resolution strategies (e.g., last-write-wins with user prompt).
- [ ] **Performance Monitoring**: Add Lighthouse CI to web pipeline.
- [ ] **Documentation**: Generate API documentation (Swagger/OpenAPI).
- [ ] **Backup System**: Implement automated backups for MongoDB.
- [ ] **Push Notifications**: Add push notifications for task reminders (Firebase/Expo Push).
