import {
  createLiveDoc, getLiveContent, reconcileLiveContent, encodeLiveState, applyLiveUpdate,
  toBase64, fromBase64, onLiveContentChange, liveRoom,
} from './markdownLive';

describe('markdownLive (CRDT core)', () => {
  it('seeds + reads content', () => {
    const doc = createLiveDoc('hello');
    expect(getLiveContent(doc)).toBe('hello');
  });

  it('reconciles with a minimal splice (prefix/suffix preserved)', () => {
    const doc = createLiveDoc('the quick brown fox');
    const changed = reconcileLiveContent(doc, 'the slow brown fox');
    expect(changed).toBe(true);
    expect(getLiveContent(doc)).toBe('the slow brown fox');
    expect(reconcileLiveContent(doc, 'the slow brown fox')).toBe(false); // no-op when equal
  });

  it('merges concurrent edits from two peers without losing either', () => {
    const a = createLiveDoc('hello world');
    const b = createLiveDoc('');
    // sync b from a
    applyLiveUpdate(b, encodeLiveState(a));
    expect(getLiveContent(b)).toBe('hello world');

    // peer A edits the start, peer B edits the end — concurrently.
    reconcileLiveContent(a, 'HELLO world');
    reconcileLiveContent(b, 'hello WORLD');

    // exchange updates both ways
    const ua = encodeLiveState(a);
    const ub = encodeLiveState(b);
    applyLiveUpdate(a, ub);
    applyLiveUpdate(b, ua);

    // both converge to the SAME text containing BOTH edits
    expect(getLiveContent(a)).toBe(getLiveContent(b));
    expect(getLiveContent(a)).toContain('HELLO');
    expect(getLiveContent(a)).toContain('WORLD');
  });

  it('base64 round-trips a binary update', () => {
    const doc = createLiveDoc('café — 漢字 😀');
    const b64 = toBase64(encodeLiveState(doc));
    const doc2 = createLiveDoc('');
    applyLiveUpdate(doc2, fromBase64(b64));
    expect(getLiveContent(doc2)).toBe('café — 漢字 😀');
  });

  it('notifies on content change', () => {
    const doc = createLiveDoc('a');
    const seen: string[] = [];
    const off = onLiveContentChange(doc, (c) => seen.push(c));
    reconcileLiveContent(doc, 'ab');
    reconcileLiveContent(doc, 'abc');
    off();
    reconcileLiveContent(doc, 'abcd');
    expect(seen).toEqual(['ab', 'abc']);
  });

  it('liveRoom is scoped per share + note', () => {
    expect(liveRoom('s1', 'n1')).toBe('mdlive:s1:n1');
  });
});
