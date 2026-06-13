import { pickAttachments } from '../services/ai/attachments';

const mockGetDocument = jest.fn();
const mockReadAsString = jest.fn();

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...args: any[]) => mockGetDocument(...args),
}));
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: (...args: any[]) => mockReadAsString(...args),
}));

describe('mobile pickAttachments', () => {
  beforeEach(() => {
    mockGetDocument.mockReset();
    mockReadAsString.mockReset();
  });

  it('returns [] when the user cancels', async () => {
    mockGetDocument.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickAttachments()).toEqual([]);
  });

  it('reads text-like files into the text field', async () => {
    mockGetDocument.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'notes.md', mimeType: 'text/markdown', uri: 'file://notes.md', size: 12 }],
    });
    mockReadAsString.mockResolvedValue('# Title\nbody');

    const result = await pickAttachments();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'notes.md', mimeType: 'text/markdown', text: '# Title\nbody' });
    expect(mockReadAsString).toHaveBeenCalledWith('file://notes.md', { encoding: 'utf8' });
  });

  it('does NOT read binary files as text (text stays undefined)', async () => {
    mockGetDocument.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'scan.pdf', mimeType: 'application/pdf', uri: 'file://scan.pdf', size: 9000 }],
    });

    const result = await pickAttachments();
    expect(result[0].text).toBeUndefined();
    expect(mockReadAsString).not.toHaveBeenCalled();
  });

  it('degrades to a metadata-only attachment when the text read throws', async () => {
    mockGetDocument.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'big.txt', mimeType: 'text/plain', uri: 'file://big.txt', size: 5 }],
    });
    mockReadAsString.mockRejectedValue(new Error('read failed'));

    const result = await pickAttachments();
    expect(result).toHaveLength(1);
    expect(result[0].text).toBeUndefined();
  });
});
