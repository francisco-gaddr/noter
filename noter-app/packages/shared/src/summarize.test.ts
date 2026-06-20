import { buildNoteSummaryPrompt, NOTE_SUMMARY_MAX_CHARS } from './summarize';

describe('buildNoteSummaryPrompt', () => {
  it('includes the title and body in the prompt', () => {
    const { prompt } = buildNoteSummaryPrompt('Groceries', 'milk, eggs, bread');
    expect(prompt).toContain('Groceries');
    expect(prompt).toContain('milk, eggs, bread');
  });

  it('caps a huge body and marks it truncated (bounds token cost)', () => {
    const big = 'x'.repeat(NOTE_SUMMARY_MAX_CHARS + 5000);
    const { prompt } = buildNoteSummaryPrompt('T', big);
    expect(prompt).toContain('[note truncated for length]');
    // body slice is capped; total prompt stays near the cap (+ title + marker)
    expect(prompt.length).toBeLessThan(NOTE_SUMMARY_MAX_CHARS + 200);
  });

  it('honours an explicit language, else defers to the note language', () => {
    expect(buildNoteSummaryPrompt('T', 'b', { language: 'sv' }).system).toContain('sv');
    expect(buildNoteSummaryPrompt('T', 'b').system.toLowerCase()).toContain('same language');
  });

  it('handles an untitled / empty note without throwing', () => {
    const { prompt } = buildNoteSummaryPrompt('', '');
    expect(prompt).toContain('(untitled)');
  });
});
