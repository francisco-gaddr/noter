/**
 * Battery-aware policy for background processing.
 *
 * powerMonitor.isOnBatteryPower() + getCurrentThermalState() let us
 * tell when the user's laptop is on battery AND when the system is
 * thermally throttled. Auto-update checks, sync polling, and large
 * background tasks should respect both.
 *
 * Pure decision function — caller passes the current power state and
 * gets back the recommended throttling policy.
 *
 * Policies:
 *   - 'normal'   — run everything as scheduled
 *   - 'reduced'  — drop polling intervals to half, skip large jobs
 *   - 'paused'   — postpone all background work until next change
 */

const KNOWN_THERMAL_STATES = new Set(['unknown', 'nominal', 'fair', 'serious', 'critical']);

const resolveBackgroundPolicy = ({ onBattery, thermalState }) => {
  const thermal = KNOWN_THERMAL_STATES.has(thermalState) ? thermalState : 'unknown';

  // Critical thermal → pause everything regardless of battery.
  if (thermal === 'critical') {
    return { policy: 'paused', reason: 'thermal-critical' };
  }
  // Serious thermal OR on-battery + serious thermal → reduced.
  if (thermal === 'serious') {
    return { policy: 'reduced', reason: 'thermal-serious' };
  }
  if (onBattery && thermal === 'fair') {
    return { policy: 'reduced', reason: 'battery-and-warm' };
  }
  if (onBattery) {
    // On battery but otherwise healthy: still run the basics, but at
    // lower cadence.
    return { policy: 'reduced', reason: 'on-battery' };
  }
  return { policy: 'normal', reason: 'on-ac' };
};

const intervalMultiplier = (policy) => {
  switch (policy) {
    case 'paused': return Infinity;
    case 'reduced': return 2;
    default: return 1;
  }
};

const shouldSkipLargeJob = (policy) => policy !== 'normal';

module.exports = {
  resolveBackgroundPolicy,
  intervalMultiplier,
  shouldSkipLargeJob,
  KNOWN_THERMAL_STATES: Array.from(KNOWN_THERMAL_STATES),
};
