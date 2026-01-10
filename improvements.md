# Improvements Audit

This document outlines identified areas for improvement across the Noter application ecosystem (Web, Mobile, Backend).

## 📱 Mobile App (React Native/Expo)

### Performance & Load Times
- [ ] **Image Optimization**: Implement `expo-image` for better caching and performance of images (if any are added later).
- [x] **List Virtualization**: Verify usage of `FlashList` everywhere (currently used in `NoteTree`). Ensure `estimatedItemSize` is accurate. (`NoteList` uses `FlashList`, `TaskList` uses `DraggableFlatList` for drag-sort support).
- [ ] **Bundle Size**: Analyze bundle size using `react-native-bundle-visualizer` and tree-shake unused dependencies.
- [ ] **Startup Time**: Move non-critical initializations to `useEffect` or lazy load them after interaction.
- [ ] **React Compiler**: Investigate enabling React Compiler (Memo) in newer React Native versions to reduce manual `useMemo`/`useCallback`.

### Stability & Fallbacks
- [x] **Offline Mode**: Improve offline support (AsyncStorage/SQLite queue implemented and verified).
- [x] **Error Boundaries**: Wrap main screens in Error Boundaries to prevent full app crashes.
- [x] **Network Handling**: Add a global `NetInfo` listener to show a "No Connection" banner and disable actions requiring API.

### UX & Functionality
- [ ] **Gestures**: Improve swipe gestures for list items (e.g., swipe to delete/complete tasks).
- [ ] **Haptic Feedback**: Add `expo-haptics` for actions like completing a task or long-pressing items.
- [ ] **Keyboard Handling**: Ensure `KeyboardAvoidingView` is correctly implemented on all screens with forms.
- [ ] **Animations**: Use `react-native-reanimated` for smoother transitions (e.g., expanding/collapsing folders).

### Security
- [x] **Secure Storage**: Use `expo-secure-store` instead of `AsyncStorage` for sensitive tokens (Auth tokens).
- [ ] **Biometrics**: Verify `LocalAuthentication` implementation covers all resume states (background -> foreground).

## 💻 Web App (Next.js)

### Performance (Lighthouse/Core Web Vitals)
- [x] **Code Splitting**: Verify `dynamic()` imports for heavy components (e.g., Rich Text Editor, Charts). (Refactored `NoteEditor.tsx` to lazy load `html2canvas`, `jspdf`, `turndown` for export features).
- [x] **Service Worker**: Ensure `sw.js` caches static assets and API responses effectively (PWA support). (Updated with Stale-While-Revalidate and Cache-First strategies).
- [ ] **Render Blocking**: Minimize blocking scripts in `layout.tsx`.

### Stability
- [x] **Hydration Errors**: Audit for any client/server mismatch (e.g., dates rendering differently on server vs client). (Implemented `StoreHydrator`, `isHydrated` check, fixed `useStore` and `i18n` initialization).
- [x] **Form Validation**: Implement `zod` + `react-hook-form` for robust client-side validation before API calls. (Implemented `react-hook-form` in `Auth.tsx`).

### Functionality
- [ ] **Drag & Drop**: Improve `react-dnd` feedback (ghost images, drop indicators).
- [ ] **Keyboard Shortcuts**: Add global shortcuts (e.g., `Ctrl+N` for new note, `Ctrl+F` for search).
- [ ] **Accessibility**: Audit ARIA labels, focus management for modals, and contrast ratios.

### Security
- [x] **XSS Prevention**: Ensure the Rich Text Editor sanitizes HTML output (e.g., dompurify). (Implemented URL sanitization in `NoteEditor.tsx`).
- [ ] **CSRF**: Verify API routes are protected against CSRF if using cookies.

## ⚙️ Backend (Node.js/Express)

### Performance
- [x] **Database Indexing**: Ensure MongoDB fields used in queries (`parentId`, `type`, `userId`) are indexed.
- [ ] **Caching**: Implement Redis caching for frequently accessed data (e.g., full note tree).
- [x] **Compression**: Enable Gzip/Brotli compression for API responses.

### Security
- [x] **Rate Limiting**: Implement `express-rate-limit` to prevent abuse.
- [x] **Input Validation**: Use `zod` or `joi` middleware to validate all incoming request bodies.
- [x] **Helmet**: Use `helmet` middleware to set secure HTTP headers.
- [x] **Sanitization**: Sanitize inputs to prevent NoSQL injection. (Implemented `express-mongo-sanitize`).

### Testing & Debugging
- [x] **Logging**: Implement structured logging (e.g., `winston` or `pino`) with log rotation. (Implemented `winston` logger).
- [ ] **Unit Tests**: Increase coverage for API routes and models (currently `jest` is set up).
- [ ] **Integration Tests**: Add tests covering the full flow (Auth -> Create Note -> Read Note).

## 🛠 General / DevOps



### Code Quality
- [ ] **Linting**: Enforce stricter ESLint rules (e.g., no unused vars, explicit return types).
- [ ] **Prettier**: Ensure Prettier runs on pre-commit hook (`husky`).
- [ ] **Types**: Eliminate `any` usage in TypeScript files (search for `as any` and replace with proper types).

### Documentation
- [ ] **API Docs**: Generate Swagger/OpenAPI documentation for the backend.
- [ ] **Setup Guide**: Improve README with clear setup instructions for new developers (Env vars, DB setup).

### CI/CD (Can save for later)
- [ ] **Pipeline**: Set up GitHub Actions for running linting (`eslint`), type checking (`tsc`), and tests (`jest`) on PRs.
- [ ] **Deployment**: Automate deployment to Vercel (Web) and EAS (Mobile).
