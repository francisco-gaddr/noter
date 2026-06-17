import { pickBestContainer, AI_DEFAULT_NOTE_FOLDER_TITLE, AI_DEFAULT_TASKLIST_TITLE } from './aiPlacement';

describe('aiPlacement.pickBestContainer', () => {
  const folders = [
    { id: 'work', title: 'Arbete' },
    { id: 'recipes', title: 'Recept och matlagning' },
    { id: 'travel', title: 'Resa Italien' },
  ];

  it('matches a note to the most relevant existing folder by title overlap', () => {
    expect(pickBestContainer('Recept på pasta carbonara', folders)).toBe('recipes');
    expect(pickBestContainer('Boka hotell inför resan till Italien', folders)).toBe('travel');
  });

  it('returns null when nothing matches well (caller uses the default AI folder)', () => {
    expect(pickBestContainer('Slumpmässig tanke om kvantfysik', folders)).toBeNull();
    expect(pickBestContainer('', folders)).toBeNull();
    expect(pickBestContainer('Recept', [])).toBeNull();
  });

  it('ignores stopwords / generic words so a vague note does not falsely match', () => {
    // "ny anteckning" is all stop/generic words → no real signal → null.
    expect(pickBestContainer('Ny anteckning', folders)).toBeNull();
  });

  it('exposes clearly-AI-named default container titles', () => {
    expect(AI_DEFAULT_NOTE_FOLDER_TITLE).toMatch(/ai/i);
    expect(AI_DEFAULT_TASKLIST_TITLE).toMatch(/ai/i);
  });
});
