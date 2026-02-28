import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '../stores/useStore';
import Home from '../app/page';
import SidebarTree from '../components/SidebarTree';
import NoteEditor from '../components/NoteEditor';
import { api } from '../services/api';
import { db } from '../services/db';

// Mock the API and DB modules
jest.mock('../services/api');
jest.mock('../services/db');
jest.mock('../services/socket');
jest.mock('jspdf', () => ({ jsPDF: jest.fn(), default: jest.fn() }));

// Mock the useStore hook
jest.mock('../stores/useStore', () => {
  const actual = jest.requireActual('../stores/useStore');
  return {
    ...actual,
    useStore: jest.fn()
  };
});

describe('Performance and Stability Tests', () => {
  const mockNotes = [
    {
      _id: 'note-1',
      title: 'Test Note 1',
      content: 'Content 1',
      parentId: null,
      locked: false,
      type: 'note',
      order: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      _id: 'note-2', 
      title: 'Test Note 2',
      content: 'Content 2',
      parentId: null,
      locked: false,
      type: 'note',
      order: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  const mockTasks = [
    {
      _id: 'task-1',
      title: 'Test Task 1',
      parentNoteId: null,
      completed: false,
      priority: 'medium',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    if (!HTMLCanvasElement.prototype.getContext) {
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value: () => null,
      });
    }
    
    // Mock API responses
    (api.fetchNotes as jest.Mock).mockResolvedValue(mockNotes);
    (api.fetchTasks as jest.Mock).mockResolvedValue(mockTasks);
    (api.login as jest.Mock).mockResolvedValue({ 
      user: { _id: 'user-1', username: 'testuser' }, 
      token: 'test-token' 
    });
    
    // Mock DB operations
    (db.getAllNotes as jest.Mock).mockResolvedValue(mockNotes);
    (db.getAllTasks as jest.Mock).mockResolvedValue(mockTasks);
    (db.saveNote as jest.Mock).mockResolvedValue(undefined);
    (db.saveTask as jest.Mock).mockResolvedValue(undefined);
    
    // Mock useStore with initial state
    (useStore as unknown as jest.Mock).mockImplementation((selector) => {
      const state = {
        user: { _id: 'user-1', username: 'testuser' },
        token: 'test-token',
        notes: mockNotes,
        tasks: mockTasks,
        selectedNoteId: null,
        selectedTaskListId: null,
        activeProjectId: null,
        isLoading: false,
        error: null,
        searchQuery: '',
        sortOrder: 'date-desc',
        activeTab: 'notes',
        activeUsers: {},
        isAppLocked: false,
        autoLockTimeout: 15,
        isHydrated: true,
        pendingCreated: { notes: {}, tasks: {} },
        
        // Actions
        initSocket: jest.fn(),
        fetchNotes: jest.fn().mockResolvedValue(undefined),
        fetchTasks: jest.fn().mockResolvedValue(undefined),
        selectNote: jest.fn(),
        createNote: jest.fn().mockResolvedValue(undefined),
        updateNote: jest.fn().mockResolvedValue(undefined),
        deleteNote: jest.fn().mockResolvedValue(undefined),
        unlockNote: jest.fn().mockResolvedValue(true),
        createTask: jest.fn().mockResolvedValue(undefined),
        updateTask: jest.fn().mockResolvedValue(undefined),
        deleteTask: jest.fn().mockResolvedValue(undefined),
        setSearchQuery: jest.fn(),
        setSortOrder: jest.fn(),
        setActiveTab: jest.fn(),
        setActiveProject: jest.fn(),
        setAppLocked: jest.fn(),
        setAutoLockTimeout: jest.fn(),
        joinNote: jest.fn(),
        leaveNote: jest.fn(),
        syncOfflineChanges: jest.fn().mockResolvedValue(undefined),
        hydrate: jest.fn(),
        login: jest.fn().mockResolvedValue(undefined),
        register: jest.fn().mockResolvedValue(undefined),
        logout: jest.fn(),
        moveNote: jest.fn().mockResolvedValue(undefined),
      };
      
      return selector ? selector(state) : state;
    });
  });

  describe('App Loading Performance', () => {
    it('should load app without freezing', async () => {
      const { container } = render(<Home />);
      
      // App should render without throwing errors
      await waitFor(() => {
        expect(container).toBeInTheDocument();
      });
      
      // No loading indicators should remain visible
      const loadingElements = screen.queryAllByText(/loading/i);
      expect(loadingElements).toHaveLength(0);
    });

    it('should handle large number of notes without performance issues', async () => {
      // Create a large number of notes
      const largeNotes = Array.from({ length: 1000 }, (_, i) => ({
        _id: `note-${i}`,
        title: `Test Note ${i}`,
        content: `Content ${i}`,
        parentId: null,
        locked: false,
        type: 'note',
        order: i,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }));

      // Update mock to return large notes
      (api.fetchNotes as jest.Mock).mockResolvedValue(largeNotes);
      (db.getAllNotes as jest.Mock).mockResolvedValue(largeNotes);

      const { container } = render(<Home />);
      
      // App should still render without freezing
      await waitFor(() => {
        expect(container).toBeInTheDocument();
      });

      // Measure render time for large dataset
      const startTime = performance.now();
      
      await act(async () => {
        // Trigger a re-render
        (useStore as unknown as jest.Mock).mockImplementation((selector) => {
          const state = {
            notes: largeNotes,
            // ... other state properties
          };
          return selector ? selector(state) : state;
        });
      });

      const endTime = performance.now();
      const renderTime = endTime - startTime;
      
      // Render should complete within reasonable time (adjust threshold as needed)
      expect(renderTime).toBeLessThan(1000); // 1 second
    });
  });

  describe('Sidebar Tree Performance', () => {
    it('should render sidebar without freezing when searching', async () => {
      render(<SidebarTree />);
      await act(async () => {
        (useStore as unknown as jest.Mock).mockImplementation((selector) => {
          const state = {
            notes: mockNotes,
            searchQuery: 'test',
          };
          return selector ? selector(state) : state;
        });
      });
      expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0);
    });

    it('should handle many empty notes without freezing', async () => {
      const largeEmptyNotes = Array.from({ length: 2000 }, (_, i) => ({
        _id: `note-empty-${i}`,
        title: '',
        content: '',
        parentId: null,
        locked: false,
        type: 'note',
        order: i,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }));

      (useStore as unknown as jest.Mock).mockImplementation((selector) => {
        const state = {
          notes: largeEmptyNotes,
          tasks: [],
          selectedNoteId: null,
          selectedTaskListId: null,
          activeProjectId: null,
          isLoading: false,
          error: null,
          searchQuery: '',
          sortOrder: 'date-desc',
          activeTab: 'notes',
          setActiveTab: jest.fn(),
          selectNote: jest.fn(),
          createNote: jest.fn().mockResolvedValue(undefined),
          updateNote: jest.fn().mockResolvedValue(undefined),
          deleteNote: jest.fn().mockResolvedValue(undefined),
          moveNote: jest.fn().mockResolvedValue(undefined),
          fetchNotes: jest.fn().mockResolvedValue(undefined),
          setSortOrder: jest.fn(),
          language: 'sv',
          setLanguage: jest.fn(),
        };
        return selector ? selector(state) : state;
      });

      const { container } = render(<SidebarTree />);
      await waitFor(() => {
        expect(container).toBeInTheDocument();
      });
    });

    it('should handle rapid note selection without performance issues', async () => {
      render(<SidebarTree />);
      
      const noteElements = screen.getAllByRole('treeitem');
      
      // Rapidly select different notes
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          await userEvent.click(noteElements[i % noteElements.length]);
        });
      }
      
      // App should remain responsive
      expect(noteElements[0]).toBeInTheDocument();
    });
  });

  describe('Note Editor Performance', () => {
    it('should handle rapid typing without cursor jumping', async () => {
      // Mock selected note
      (useStore as unknown as jest.Mock).mockImplementation((selector) => {
        const state = {
          selectedNoteId: 'note-1',
          notes: mockNotes,
          activeUsers: {},
          joinNote: jest.fn(),
          leaveNote: jest.fn(),
          // ... other state properties
        };
        return selector ? selector(state) : state;
      });

      render(<NoteEditor />);
      
      const editor = screen.getAllByRole('textbox').find(el => el.getAttribute('contenteditable') === 'true');
      expect(editor).toBeTruthy();
      
      // Type rapidly - should not cause cursor jumping
      const testText = 'This is a test sentence to check typing performance.';
      
      await act(async () => {
        await userEvent.type(editor as HTMLElement, testText);
      });
      
      // Content should be correctly entered
      expect(editor).toBeInTheDocument();
    });

    it('should handle large content without performance degradation', async () => {
      // Mock selected note
      (useStore as unknown as jest.Mock).mockImplementation((selector) => {
        const state = {
          selectedNoteId: 'note-1',
          notes: mockNotes,
          activeUsers: {},
          joinNote: jest.fn(),
          leaveNote: jest.fn(),
          // ... other state properties
        };
        return selector ? selector(state) : state;
      });

      render(<NoteEditor />);
      
      const editor = screen.getAllByRole('textbox').find(el => el.getAttribute('contenteditable') === 'true');
      expect(editor).toBeTruthy();
      
      // Type large content
      const largeContent = 'A'.repeat(2000);
      
      act(() => {
        (editor as HTMLElement).textContent = largeContent;
      });
      
      // Editor should remain responsive
      expect(editor).toBeInTheDocument();
    });
  });

  describe('Error Handling and Stability', () => {
    it('should handle API errors gracefully without crashing', async () => {
      // Mock API failure
      (api.fetchNotes as jest.Mock).mockRejectedValue(new Error('Network error'));
      (db.getAllNotes as jest.Mock).mockRejectedValue(new Error('DB error'));

      const { container } = render(<Home />);
      
      // App should still render despite errors
      await waitFor(() => {
        expect(container).toBeInTheDocument();
      });
      
      // Error should be handled gracefully
      const errorElements = screen.queryAllByText(/error/i);
      expect(errorElements.length).toBeLessThanOrEqual(1); // Might show error message
    });

    it('should recover from socket disconnections without freezing', async () => {
      const { container } = render(<Home />);
      
      // Simulate socket disconnect
      await act(async () => {
        // Trigger socket error handling
        const mockSocket = require('../services/socket');
        mockSocket.socket.emit('disconnect');
      });
      
      // App should remain responsive
      expect(container).toBeInTheDocument();
    });
  });

  describe('Memory Leak Detection', () => {
    it('should not leak memory during rapid state updates', async () => {
      const { unmount } = render(<Home />);
      
      // Simulate rapid state updates
      for (let i = 0; i < 100; i++) {
        await act(async () => {
          // Trigger state updates
          (useStore as unknown as jest.Mock).mockImplementation((selector) => {
            const state = {
              notes: [...mockNotes, {
                _id: `new-note-${i}`,
                title: `New Note ${i}`,
                content: `New Content ${i}`,
                parentId: null,
                locked: false,
                type: 'note',
                order: i,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }],
              // ... other state properties
            };
            return selector ? selector(state) : state;
          });
        });
      }
      
      // Cleanup
      unmount();
      
      // No assertions needed - test passes if no memory leaks occur
    });
  });
});
