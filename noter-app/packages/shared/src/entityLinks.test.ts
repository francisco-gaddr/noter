import { parseEntityLinks, serializeEntityLinks, toggleEntityLink, DEFAULT_LINK_REL } from './entityLinks';

describe('parseEntityLinks', () => {
  it('parses an array or a JSON string, dropping invalid/duplicate targets', () => {
    expect(parseEntityLinks([{ targetId: 'a', rel: 'linked' }])).toEqual([{ targetId: 'a', rel: 'linked' }]);
    expect(parseEntityLinks('[{"targetId":"a","rel":"depends_on"}]')).toEqual([{ targetId: 'a', rel: 'depends_on' }]);
    expect(parseEntityLinks([{ targetId: 'a' }, { targetId: 'a' }, { foo: 1 }])).toEqual([{ targetId: 'a', rel: DEFAULT_LINK_REL }]);
    expect(parseEntityLinks('')).toEqual([]);
    expect(parseEntityLinks('not json')).toEqual([]);
    expect(parseEntityLinks(null)).toEqual([]);
  });
});

describe('serializeEntityLinks', () => {
  it('round-trips through parse and yields "" for empty', () => {
    const links = [{ targetId: 'a', rel: 'linked' }, { targetId: 'b', rel: 'related' }];
    expect(parseEntityLinks(serializeEntityLinks(links))).toEqual(links);
    expect(serializeEntityLinks([])).toBe('');
    expect(serializeEntityLinks(null)).toBe('');
  });
});

describe('toggleEntityLink', () => {
  it('adds then removes a link to a target', () => {
    const a = toggleEntityLink([], 'x');
    expect(a).toEqual([{ targetId: 'x', rel: DEFAULT_LINK_REL }]);
    expect(toggleEntityLink(a, 'x')).toEqual([]);
    expect(toggleEntityLink(a, 'y', 'depends_on')).toEqual([{ targetId: 'x', rel: 'linked' }, { targetId: 'y', rel: 'depends_on' }]);
  });
});
