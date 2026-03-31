import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AISidebar } from '../components/AISidebar';
import { useStore } from '../stores/useStore';

// Mocks
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

jest.mock('../services/db', () => ({
    db: {
        getConversations: jest.fn().mockResolvedValue([
            { id: '1', title: 'Test Chat', updatedAt: new Date().toISOString() }
        ]),
        saveConversation: jest.fn(),
        getMessages: jest.fn().mockResolvedValue([]),
        saveMessage: jest.fn(),
        deleteConversation: jest.fn()
    }
}));

// Mock fetch
global.fetch = jest.fn(() => 
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
        body: {
            getReader: () => ({
                read: () => Promise.resolve({ done: true, value: new Uint8Array() })
            })
        }
    })
) as jest.Mock;

Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    value: jest.fn(),
    writable: true,
});

describe('AISidebar', () => {
    beforeEach(() => {
        localStorage.clear();
        useStore.setState({ user: { _id: '1', username: 'test' }, token: 'test-jwt-token' } as any);
        (global.fetch as jest.Mock).mockClear();
        (window as any).mlc = {
            isElectron: false,
            getModels: jest.fn().mockResolvedValue([]),
            searchModels: jest.fn().mockResolvedValue([]),
            getModelFiles: jest.fn().mockResolvedValue([]),
            downloadAndConvert: jest.fn().mockResolvedValue(true),
            deleteModel: jest.fn().mockResolvedValue(true),
            chat: jest.fn().mockResolvedValue(true),
            cancelChat: jest.fn().mockResolvedValue(true),
            onDownloadProgress: jest.fn(() => () => {}),
            onChatToken: jest.fn(() => () => {}),
            getPerformanceSnapshot: jest.fn().mockResolvedValue({
                appStartedAt: 100,
                startup: { windowShownAt: 350, lastLoadSource: 'dev-url', recoveryCount: 1, didFailLoadCount: 0 },
                settingsQueue: { enqueued: 2, flushes: 1, lastFlushDurationMs: 18 },
                ai: {
                    downloads: { lastModelId: 'mock-model', lastProgressEventCount: 4, failureCount: 0 },
                    chats: { lastChatId: 'chat-1', lastTokenCount: 12, failureCount: 0 },
                },
            }),
            resetPerformanceSnapshot: jest.fn().mockResolvedValue(true),
            getSetting: jest.fn().mockResolvedValue(null),
            setSetting: jest.fn().mockResolvedValue(true),
        };
    });

    it('renders closed by default', async () => {
        await act(async () => {
            render(<AISidebar />);
        });
        expect(screen.getByRole('button', { name: /AI/i })).toBeInTheDocument();
    });

    it('opens sidebar on click', async () => {
        await act(async () => {
            render(<AISidebar />);
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /AI/i }));
        });
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
    });

    it('opens settings and menu', async () => {
        await act(async () => {
            render(<AISidebar />);
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /AI/i }));
        });
        
        await act(async () => {
            fireEvent.click(screen.getByLabelText('Öppna AI-inställningar'));
        });
        expect(screen.getByText('Systemprompt')).toBeInTheDocument();
        
        await act(async () => {
            fireEvent.click(screen.getByLabelText('Öppna AI-meny'));
        });
        expect(screen.getByText('Chattar')).toBeInTheDocument();
    });

    it('loads saved ai provider from storage', async () => {
        localStorage.setItem('aiProvider', 'lmstudio');
        localStorage.setItem('lmstudioModel', 'saved-model');

        await act(async () => {
            render(<AISidebar />);
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /AI/i }));
        });
        await waitFor(() => {
            expect(screen.getByLabelText('Öppna AI-inställningar')).toBeInTheDocument();
        });
        await act(async () => {
            fireEvent.click(screen.getByLabelText('Öppna AI-inställningar'));
        });

        await waitFor(() => {
            const providerSelect = screen.getByTestId('ai-provider-select') as HTMLSelectElement;
            expect(providerSelect.value).toBe('lmstudio');
        });
    });

    it('supports local-only ai sync mode in settings', async () => {
        localStorage.setItem('aiSyncWithBackend', 'false');

        await act(async () => {
            render(<AISidebar />);
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /AI/i }));
        });
        await act(async () => {
            fireEvent.click(screen.getByLabelText('Öppna AI-inställningar'));
        });

        const syncToggle = screen.getByLabelText('Synka AI-chattar med backend') as HTMLInputElement;
        expect(syncToggle.checked).toBe(false);
    });

    it('persists prompt preset and tool access settings', async () => {
        await act(async () => {
            render(<AISidebar />);
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /AI/i }));
        });
        await act(async () => {
            fireEvent.click(screen.getByLabelText('Öppna AI-inställningar'));
        });

        fireEvent.change(screen.getByTestId('ai-prompt-preset-select'), { target: { value: 'execution' } });
        fireEvent.change(screen.getByTestId('ai-tool-access-mode-select'), { target: { value: 'read-only' } });

        await waitFor(() => {
            expect(localStorage.getItem('aiPromptPreset')).toBe('execution');
            expect(localStorage.getItem('aiToolAccessMode')).toBe('read-only');
        });
    });

    it('shows conversion diagnostics in settings', async () => {
        (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/app/api/ai/models/health')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        mode: 'local',
                        localBinaryAvailable: true,
                        storageWritable: true,
                        resolvedCommand: 'py -m mlc_llm',
                        installHint: '',
                    }),
                });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve([]),
                body: {
                    getReader: () => ({
                        read: () => Promise.resolve({ done: true, value: new Uint8Array() })
                    })
                }
            });
        });

        await act(async () => {
            render(<AISidebar />);
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /AI/i }));
        });
        await act(async () => {
            fireEvent.click(screen.getByLabelText('Öppna AI-inställningar'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('ai-conversion-health-panel')).toBeInTheDocument();
            expect(screen.getByText('Lokal MLC-konvertering är redo.')).toBeInTheDocument();
            expect(screen.getByText(/py -m mlc_llm/)).toBeInTheDocument();
        });
    });

    it('shows electron performance snapshots in the system dashboard', async () => {
        (window as any).mlc.isElectron = true;

        await act(async () => {
            render(<AISidebar />);
        });

        await act(async () => {
            window.dispatchEvent(new Event('open-system-dashboard'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('system-dashboard-section')).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Prestanda' }));
        });

        await waitFor(() => {
            expect(screen.getByTestId('electron-performance-tab')).toBeInTheDocument();
            expect(screen.getByText('Electron-prestandasnapshots')).toBeInTheDocument();
            expect(screen.getByTestId('electron-performance-raw')).toHaveTextContent('mock-model');
        });
    });
});
