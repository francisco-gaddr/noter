import React from 'react';
import renderer, { act } from 'react-test-renderer';
import SearchScreen from '../app/(tabs)/search';
import { createMockStoreState } from './helpers/mockUseStore';

let mockCapturedNotes: any[] = [];

jest.mock('react-native-paper', () => {
  const React = require('react');
  return {
    Searchbar: ({ onChangeText }: any) => React.createElement('Searchbar', { onChangeText }),
    Text: ({ children }: any) => React.createElement('Text', null, children),
    useTheme: () => ({ colors: { background: '#fff', surface: '#fff', outlineVariant: '#ddd' } }),
  };
});

jest.mock('react-native', () => ({
  StyleSheet: { create: () => ({}) },
  View: ({ children }: any) => {
    const React = require('react');
    return React.createElement('View', null, children);
  },
}));

jest.mock('@shopify/flash-list', () => ({
  FlashList: ({ data, renderItem }: any) => {
    const React = require('react');
    return React.createElement(
      'FlashList',
      null,
      (data || []).map((item: any, index: number) => React.createElement(React.Fragment, { key: item.id || index }, renderItem({ item, index })))
    );
  },
}));

const mockStoreState = createMockStoreState({
  notes: [
    { _id: 'pLocked', title: 'Låst projekt', content: '', type: 'project', parentId: null, locked: true, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    { _id: 'nLocked', title: 'Hemlig anteckning', content: '', type: 'note', parentId: 'pLocked', locked: true, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    { _id: 'nOpen', title: 'Publik anteckning', content: 'synlig text', type: 'note', parentId: null, locked: false, tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  ],
  tasks: [],
  updateTask: jest.fn(),
});

jest.mock('@/stores/useStore', () => ({
  ...require('./helpers/mockUseStore').createSelectorStoreMock(() => mockStoreState),
}));

jest.mock('@/components/NoteItem', () => ({
  NoteItem: ({ note }: any) => {
    mockCapturedNotes.push(note);
    return null;
  },
}));

jest.mock('@/components/TaskItem', () => ({
  TaskItem: () => null,
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

describe('Search locked notes e2e', () => {
  beforeEach(() => {
    mockCapturedNotes = [];
  });

  it('visar inte låsta anteckningar eller låsta projekt i sökresultat', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SearchScreen />);
    });

    const searchbar = (tree!.root as any).findAll((node: any) => node.type === 'Searchbar')[0];
    await act(async () => {
      searchbar.props.onChangeText('anteckning');
    });

    const titles = mockCapturedNotes.map((n: any) => n.title);
    expect(titles).toContain('Publik anteckning');
    expect(titles).not.toContain('Hemlig anteckning');
    expect(titles).not.toContain('Låst projekt');
  });
});
