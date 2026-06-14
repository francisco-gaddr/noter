import { parseEmbeddingsConfig, defaultEmbeddingsConfig, embeddingText, embeddingContentHash, serializeEmbeddingsConfig, DEFAULT_EMBEDDING_MODEL } from './embeddings';

describe('embeddings config', () => {
  it('defaults are off + hermes + nomic', () => {
    expect(defaultEmbeddingsConfig()).toMatchObject({ enabled: false, source: 'hermes', model: DEFAULT_EMBEDDING_MODEL });
  });
  it('parses JSON string + object, validating source/model', () => {
    expect(parseEmbeddingsConfig('{"enabled":true,"source":"api","model":"text-embedding-3-small"}')).toMatchObject({ enabled: true, source: 'api', model: 'text-embedding-3-small' });
    expect(parseEmbeddingsConfig({ source: 'bogus', model: '' }).source).toBe('hermes');
    expect(parseEmbeddingsConfig(null)).toMatchObject(defaultEmbeddingsConfig());
    expect(parseEmbeddingsConfig('not json')).toMatchObject(defaultEmbeddingsConfig());
  });
  it('round-trips through serialize', () => {
    const c = { ...defaultEmbeddingsConfig(), enabled: true, autoIndex: true };
    expect(parseEmbeddingsConfig(serializeEmbeddingsConfig(c))).toMatchObject(c);
  });
});

describe('embeddingText + hash', () => {
  it('weights the title and caps length', () => {
    const txt = embeddingText('Recept', 'mjöl socker', 1500);
    expect(txt).toContain('Recept\nRecept');
    expect(embeddingText('t'.repeat(2000), 'x', 100).length).toBe(100);
  });
  it('hash is stable for same text and changes with content', () => {
    expect(embeddingContentHash('abc')).toBe(embeddingContentHash('abc'));
    expect(embeddingContentHash('abc')).not.toBe(embeddingContentHash('abd'));
  });
});
