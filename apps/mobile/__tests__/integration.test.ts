import IconPickerModal from '../components/IconPickerModal';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
}));

jest.mock('expo-constants', () => ({
  expoConfig: {
    extra: {
      buildId: 'test',
      buildTime: 'test',
    },
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({ id: '1' }),
  Stack: { Screen: () => null },
}));

jest.mock('react-native-pell-rich-editor', () => ({
  RichEditor: 'RichEditor',
  RichToolbar: 'RichToolbar',
  actions: {},
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => ({
    execAsync: jest.fn(),
    runAsync: jest.fn(),
    getAllAsync: jest.fn(),
  })),
}));

jest.mock('expo-localization', () => ({
  locale: 'en-US',
  locales: ['en-US'],
}));

// We need to require NoteEditorScreen after mocks
const NoteEditorScreen = require('../app/note/[id]').default;

describe('Mobile Integration', () => {
  it('should import components successfully', () => {
    expect(IconPickerModal).toBeDefined();
    expect(NoteEditorScreen).toBeDefined();
  });
});
