/**
 * WebSocket transport-security helper — guarantees that WebSocket traffic to any PUBLIC
 * host always uses TLS (wss://), regardless of how the base URL was configured. Private
 * / LAN / dev / tailnet hosts keep their scheme (they're either loopback, on an isolated
 * network, or already encrypted by WireGuard), so local development against a plain-HTTP
 * Pi keeps working.
 *
 * Pure + dependency-free + unit-tested; used by both the web and mobile socket clients so
 * the rule is identical everywhere. Note: the message PAYLOADS are independently E2E
 * encrypted (encrypt() envelopes) — this only hardens the transport + the JWT handshake.
 */

/**
 * Hosts we treat as private (keep their scheme): loopback, RFC1918 LAN, link-local,
 * *.local mDNS, and the Tailscale CGNAT range 100.64.0.0/10.
 */
export const isPrivateSocketHost = (hostWithPort: string): boolean => {
  let host = (hostWithPort || '').trim().toLowerCase();
  // Bracketed IPv6 (with optional port): [::1]:3001 → ::1
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(host);
  if (bracket) host = bracket[1];
  // host:port for IPv4 / hostnames only (a single colon) — never strip from bare IPv6.
  else if (/^[^:]+:\d+$/.test(host)) host = host.replace(/:\d+$/, '');
  if (!host) return true; // be conservative: empty → don't force-upgrade
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return true;
  if (host.endsWith('.local')) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // Tailscale CGNAT 100.64.0.0/10 → 100.64.x.x … 100.127.x.x
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
};

/**
 * Upgrade ws→wss / http→https for public hosts. Private/LAN/tailnet hosts are returned
 * unchanged. Accepts a full URL (preferred) or a bare host; on a parse failure it leaves
 * the value untouched (the caller's own scheme logic still applies).
 */
export const enforceSecureSocketUrl = (url: string): string => {
  const raw = (url || '').trim();
  if (!raw) return raw;
  // Try to parse as a URL with a scheme.
  const m = /^([a-z]+):\/\/([^/]+)(.*)$/i.exec(raw);
  if (m) {
    const scheme = m[1].toLowerCase();
    const host = m[2];
    const rest = m[3] || '';
    if (isPrivateSocketHost(host)) return raw;
    const secure = scheme === 'ws' ? 'wss' : scheme === 'http' ? 'https' : scheme;
    return `${secure}://${host}${rest}`.replace(/\/$/, '');
  }
  // Bare host (no scheme): upgrade to wss for public hosts.
  if (isPrivateSocketHost(raw)) return raw;
  return `wss://${raw}`.replace(/\/$/, '');
};
