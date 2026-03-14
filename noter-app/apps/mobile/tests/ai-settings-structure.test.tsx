import fs from 'fs';
import path from 'path';

describe('mobile ai settings structure parity', () => {
  const filePath = path.join(__dirname, '..', 'app', '(tabs)', 'ai.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  it('contains models and instructions tabs in ai settings', () => {
    expect(source).toContain("testID=\"ai-settings-tab-models\"");
    expect(source).toContain("testID=\"ai-settings-tab-instructions\"");
  });

  it('contains explicit model download action in settings', () => {
    expect(source).toContain("testID=\"ai-open-download-models-dialog\"");
  });
});
