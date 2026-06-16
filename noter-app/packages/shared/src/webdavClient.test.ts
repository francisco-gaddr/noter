import {
  classifyFile,
  normalizeNextcloudBaseUrl,
  enforceHttps,
  encodeDavPath,
  joinDavUrl,
  isUnderRoots,
  normalizePath,
  buildPropfindBody,
  parsePropfindXml,
} from './webdavClient';

describe('webdavClient: classification + url helpers', () => {
  it('classifies files by extension and mime', () => {
    expect(classifyFile('report.pdf')).toBe('pdf');
    expect(classifyFile('x', 'application/pdf')).toBe('pdf');
    expect(classifyFile('note.md')).toBe('text');
    expect(classifyFile('data.json')).toBe('text');
    expect(classifyFile('a', 'text/plain')).toBe('text');
    expect(classifyFile('pic.JPG')).toBe('image');
    expect(classifyFile('b', 'image/png')).toBe('image');
    expect(classifyFile('archive.zip')).toBe('skip');
  });

  it('normalizes a Nextcloud base url from host + user', () => {
    expect(normalizeNextcloudBaseUrl('cloud.example.com', 'alice')).toBe(
      'https://cloud.example.com/remote.php/dav/files/alice/',
    );
    expect(normalizeNextcloudBaseUrl('https://c.ex/', 'bob')).toBe(
      'https://c.ex/remote.php/dav/files/bob/',
    );
    // already a full dav path is preserved
    expect(normalizeNextcloudBaseUrl('https://c.ex/remote.php/dav/files/x', 'x')).toBe(
      'https://c.ex/remote.php/dav/files/x/',
    );
  });

  it('enforces TLS but allows localhost/LAN http for dev', () => {
    expect(() => enforceHttps('https://c.ex/')).not.toThrow();
    expect(() => enforceHttps('http://localhost:8080/')).not.toThrow();
    expect(() => enforceHttps('http://192.168.50.16/dav')).not.toThrow();
    expect(() => enforceHttps('http://cloud.example.com/')).toThrow();
  });

  it('encodes paths and joins urls keeping slashes', () => {
    expect(encodeDavPath('A B/c+d.md')).toBe('A%20B/c%2Bd.md');
    expect(joinDavUrl('https://c.ex/dav/', 'Research/x y.pdf')).toBe(
      'https://c.ex/dav/Research/x%20y.pdf',
    );
  });

  it('scopes paths strictly under selected roots', () => {
    expect(isUnderRoots('Research/x.md', ['Research'])).toBe(true);
    expect(isUnderRoots('Research', ['Research'])).toBe(true);
    expect(isUnderRoots('ResearchOther/x', ['Research'])).toBe(false);
    expect(isUnderRoots('Private/x', ['Research'])).toBe(false);
    expect(normalizePath('/a//b/')).toBe('a/b');
  });
});

describe('webdavClient: PROPFIND parsing', () => {
  const baseUrl = 'https://cloud.example.com/remote.php/dav/files/alice/';
  const xml = `<?xml version="1.0"?>
  <d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
    <d:response>
      <d:href>/remote.php/dav/files/alice/Research/</d:href>
      <d:propstat><d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getetag>"abc"</d:getetag>
      </d:prop></d:propstat>
    </d:response>
    <d:response>
      <d:href>/remote.php/dav/files/alice/Research/rapport%20q1.pdf</d:href>
      <d:propstat><d:prop>
        <d:resourcetype/>
        <d:getetag>"deadbeef"</d:getetag>
        <d:getcontentlength>10240</d:getcontentlength>
        <d:getcontenttype>application/pdf</d:getcontenttype>
        <d:getlastmodified>Mon, 16 Jun 2026 10:00:00 GMT</d:getlastmodified>
      </d:prop></d:propstat>
    </d:response>
    <d:response>
      <d:href>/remote.php/dav/files/alice/Research/Under/note.md</d:href>
      <d:propstat><d:prop>
        <d:resourcetype/>
        <d:getetag>W/"v2"</d:getetag>
        <d:getcontenttype>text/markdown</d:getcontenttype>
      </d:prop></d:propstat>
    </d:response>
  </d:multistatus>`;

  it('builds a depth-1 propfind body with the props we need', () => {
    const body = buildPropfindBody();
    expect(body).toContain('<d:getetag/>');
    expect(body).toContain('<d:resourcetype/>');
    expect(body).toContain('xmlns:d="DAV:"');
  });

  it('parses entries with paths relative to baseUrl, decoding + stripping the root', () => {
    const entries = parsePropfindXml(xml, baseUrl);
    expect(entries.map((e) => e.path)).toEqual([
      'Research',
      'Research/rapport q1.pdf',
      'Research/Under/note.md',
    ]);
    const folder = entries[0];
    expect(folder.isCollection).toBe(true);
    expect(folder.etag).toBe('abc');

    const pdf = entries[1];
    expect(pdf.isCollection).toBe(false);
    expect(pdf.etag).toBe('deadbeef');
    expect(pdf.size).toBe(10240);
    expect(pdf.contentType).toBe('application/pdf');
    expect(pdf.name).toBe('rapport q1.pdf');

    const md = entries[2];
    expect(md.etag).toBe('v2'); // weak validator prefix stripped
  });

  it('drops the requested collection itself and tolerates empty xml', () => {
    expect(parsePropfindXml('', baseUrl)).toEqual([]);
    const onlySelf = parsePropfindXml(
      `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${'/remote.php/dav/files/alice/'}</d:href></d:response></d:multistatus>`,
      baseUrl,
    );
    expect(onlySelf).toEqual([]);
  });
});
