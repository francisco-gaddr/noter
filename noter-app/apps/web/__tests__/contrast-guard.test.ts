import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * A11y guard: base dark-gray text (text-gray-600/700/800) on a dark surface is
 * unreadable (the reported #374151-on-#111827 = 1.72 contrast). Every such BASE
 * color token must be paired with a `dark:text-...` override on the same element.
 * This test fails if a new violation is introduced, protecting against the class.
 *
 * It only flags the *base* token (e.g. `text-gray-700`), not state variants like
 * `hover:text-gray-700` (those don't set the resting color).
 */
const RISKY = /(?:^|\s)text-gray-(?:600|700|800)(?:\s|$)/;
const HAS_DARK_TEXT = /dark:text-(?:gray|white|slate|zinc|neutral)/;

const collectTsx = (dir: string): string[] => {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      out = out.concat(collectTsx(full));
    } else if (full.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
};

describe('a11y contrast guard (dark-gray text needs a dark: variant)', () => {
  it('has no base text-gray-600/700/800 without a dark:text override', () => {
    const root = path.join(__dirname, '..');
    const files = [...collectTsx(path.join(root, 'components')), ...collectTsx(path.join(root, 'app'))];
    const violations: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // Pull each className="..." literal and inspect it.
        const classNames = line.match(/className\s*=\s*"([^"]*)"/g) || [];
        for (const cn of classNames) {
          if (RISKY.test(cn) && !HAS_DARK_TEXT.test(cn)) {
            violations.push(`${path.relative(root, file)}:${i + 1}  ${cn.slice(0, 90)}`);
          }
        }
      });
    }

    if (violations.length > 0) {
      throw new Error(
        `Low-contrast dark-gray text without a dark: variant (${violations.length}):\n` +
          violations.join('\n') +
          '\nAdd e.g. `dark:text-gray-300` to each.',
      );
    }
    expect(violations).toEqual([]);
  });
});
