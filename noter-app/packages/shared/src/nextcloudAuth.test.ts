import {
  buildLoginFlowInitUrl,
  parseLoginFlowInit,
  loginFlowPollBody,
  parseLoginFlowResult,
  baseUrlFromLoginResult,
} from './nextcloudAuth';

describe('nextcloudAuth: Login Flow v2 helpers', () => {
  it('builds the init url from a host, tolerating scheme + dav paths', () => {
    expect(buildLoginFlowInitUrl('cloud.ex.se')).toBe('https://cloud.ex.se/index.php/login/v2');
    expect(buildLoginFlowInitUrl('https://cloud.ex.se/')).toBe('https://cloud.ex.se/index.php/login/v2');
    expect(buildLoginFlowInitUrl('https://cloud.ex.se/remote.php/dav/files/alice/')).toBe('https://cloud.ex.se/index.php/login/v2');
  });

  it('parses the init response, rejecting bad shapes', () => {
    const ok = parseLoginFlowInit({ poll: { token: 'T', endpoint: 'https://cloud.ex.se/login/v2/poll' }, login: 'https://cloud.ex.se/login/flow' });
    expect(ok).toEqual({ pollToken: 'T', pollEndpoint: 'https://cloud.ex.se/login/v2/poll', loginUrl: 'https://cloud.ex.se/login/flow' });
    expect(parseLoginFlowInit(JSON.stringify({ poll: { token: 'T', endpoint: 'e' }, login: 'l' }))?.pollToken).toBe('T');
    expect(parseLoginFlowInit({ poll: { token: 'T' }, login: 'l' })).toBe(null);
    expect(parseLoginFlowInit('nope')).toBe(null);
  });

  it('encodes the poll body', () => {
    expect(loginFlowPollBody('a b/c')).toBe('token=a%20b%2Fc');
  });

  it('parses the poll success result, null while pending', () => {
    const r = parseLoginFlowResult({ server: 'https://cloud.ex.se', loginName: 'alice', appPassword: 'secret-pw' });
    expect(r).toEqual({ server: 'https://cloud.ex.se', loginName: 'alice', appPassword: 'secret-pw' });
    expect(parseLoginFlowResult({ server: 'x' })).toBe(null); // pending / incomplete
    expect(parseLoginFlowResult('')).toBe(null);
  });

  it('derives the WebDAV base url from a result', () => {
    expect(baseUrlFromLoginResult({ server: 'https://cloud.ex.se/', loginName: 'al ice', appPassword: 'p' }))
      .toBe('https://cloud.ex.se/remote.php/dav/files/al%20ice/');
  });
});
