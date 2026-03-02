import { normalizeLmStudioBaseUrl, splitSseBuffer, extractLmStudioText } from './lmstudio';

describe('lmstudio helpers', () => {
  it('normalizes base url', () => {
    expect(normalizeLmStudioBaseUrl('http://localhost:1234/')).toBe('http://localhost:1234');
    expect(normalizeLmStudioBaseUrl('http://192.168.1.2:1234/api/v1/models.')).toBe('http://192.168.1.2:1234');
  });

  it('splits sse buffer and keeps remainder', () => {
    const { lines, buffer } = splitSseBuffer('data: {"a":1}', '\n\ndata: {"b":2}');
    expect(lines).toEqual(['data: {"a":1}', '']);
    expect(buffer).toBe('data: {"b":2}');
  });

  it('extracts full text from output and computes delta', () => {
    const first = extractLmStudioText({ output: [{ type: 'message', content: 'Hej' }] }, '');
    expect(first.delta).toBe('Hej');
    const second = extractLmStudioText({ output: [{ type: 'message', content: 'Hej då' }] }, 'Hej');
    expect(second.delta).toBe(' då');
  });
});
