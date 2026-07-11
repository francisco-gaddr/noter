import { decideErrorNetAction } from '../services/errorTracking';

/**
 * The crash-survival CONTRACT. The mobile "app crashes when chatting" bug was a global handler that
 * re-raised escaping errors to RN's fatal default. These assert the decision that must never regress:
 * in a RELEASE build the net survives (never chains to fatal); in DEV it keeps the red-box.
 */
describe('decideErrorNetAction — crash-survival contract', () => {
  it('RELEASE: a FATAL error is survived and NEVER re-raised to the default handler', () => {
    const a = decideErrorNetAction({ isFatal: true, isDev: false, alertsShown: 0, maxAlerts: 3 });
    expect(a.survive).toBe(true);
    expect(a.chainRedbox).toBe(false); // the crash path — must stay false
    expect(a.report).toBe(true);
    expect(a.alert).toBe(true);
  });

  it('RELEASE: a non-fatal error is also survived', () => {
    const a = decideErrorNetAction({ isFatal: false, isDev: false, alertsShown: 0, maxAlerts: 3 });
    expect(a.survive).toBe(true);
    expect(a.chainRedbox).toBe(false);
  });

  it('RELEASE: the user alert is throttled to maxAlerts, but survival never stops', () => {
    const atCap = decideErrorNetAction({ isFatal: true, isDev: false, alertsShown: 3, maxAlerts: 3 });
    expect(atCap.alert).toBe(false); // no more alerts…
    expect(atCap.survive).toBe(true); // …but the app STILL survives
    expect(atCap.report).toBe(true); // …and still reports to telemetry
  });

  it('DEV: chains to the red-box so real bugs stay visible, and still reports', () => {
    const a = decideErrorNetAction({ isFatal: true, isDev: true, alertsShown: 0, maxAlerts: 3 });
    expect(a.chainRedbox).toBe(true);
    expect(a.survive).toBe(false);
    expect(a.report).toBe(true);
    expect(a.alert).toBe(false);
  });
});
