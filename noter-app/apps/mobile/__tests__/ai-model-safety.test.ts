/**
 * Regression guards for the AI model-search / picker helpers: malformed or empty inputs
 * (a flaky HF response, a failed file fetch) must NEVER throw — a throw here bubbles into
 * the model browser render and trips the screen ErrorBoundary, which the user experiences
 * as "the AI tab crashes when searching for models".
 */
import { sortModels, type HFModel, type HFFile } from '@repo/ai';

// modelService pulls in native-only siblings (sqlite db + RNFS downloader); stub them so the
// pure helper under test loads under jest.
jest.mock('@/services/database', () => ({ saveModelLocal: jest.fn(), deleteModelLocal: jest.fn() }));
jest.mock('@/services/ai/ModelDownloader', () => ({
  downloadGgufModel: jest.fn(),
  getModelPath: jest.fn(() => '/tmp/m.gguf'),
  stopModelDownload: jest.fn(),
  modelFileExists: jest.fn(),
  deleteModelFile: jest.fn(),
}));
jest.mock('expo-device', () => ({ totalMemory: 4 * 1024 * 1024 * 1024 }));
jest.mock('uuid', () => ({ v4: () => 'test-uuid' })); // uuid ships ESM that jest can't parse raw

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getBestQuantization } = require('@/services/ai/modelService');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { recommendFileForDevice, assessModelFit } = require('@/services/ai/hardware');

const file = (q: string, size: number): HFFile => ({ filename: `${q}.gguf`, size, url: 'u', quantization: q });

describe('sortModels — never throws on malformed input', () => {
  it('returns [] for undefined/null', () => {
    expect(sortModels(undefined as any, 'downloads')).toEqual([]);
    expect(sortModels(null as any, 'likes')).toEqual([]);
  });
  it('drops null / id-less entries instead of crashing the comparator', () => {
    const dirty = [null, undefined, { likes: 5 }, { id: 'a', likes: 2 }, { id: 'b', likes: 9 }] as any;
    const out = sortModels(dirty, 'likes');
    expect(out.map((m: HFModel) => m.id)).toEqual(['b', 'a']); // sorted, malformed dropped
  });
});

describe('getBestQuantization — guards empty/undefined', () => {
  it('returns undefined for undefined/null/[]', () => {
    expect(getBestQuantization(undefined)).toBeUndefined();
    expect(getBestQuantization(null)).toBeUndefined();
    expect(getBestQuantization([])).toBeUndefined();
  });
  it('skips non-object rows and still picks the preferred quant', () => {
    const files = [null, file('Q8_0', 9), file('Q4_K_M', 4)] as any;
    expect(getBestQuantization(files)?.quantization).toBe('Q4_K_M');
  });
});

describe('recommendFileForDevice / assessModelFit — never throw', () => {
  it('returns undefined for empty/garbage', () => {
    expect(recommendFileForDevice(undefined)).toBeUndefined();
    expect(recommendFileForDevice([])).toBeUndefined();
    expect(recommendFileForDevice([null, { size: NaN }] as any)).toBeUndefined();
  });
  it('picks a comfortable quant and never throws on bad sizes', () => {
    const files = [file('Q4_K_M', 1.5e9), file('Q8_0', 3.5e9), { filename: 'x', size: undefined } as any];
    expect(() => recommendFileForDevice(files)).not.toThrow();
    expect(recommendFileForDevice(files)).toBeTruthy();
  });
  it('assessModelFit tolerates undefined/0', () => {
    expect(assessModelFit(undefined).level).toBe('unknown');
    expect(assessModelFit(0).level).toBe('unknown');
  });
});
