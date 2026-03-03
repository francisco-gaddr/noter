import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AISidebar } from '../components/AISidebar';
import { useStore } from '../stores/useStore';

// Mocks
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
});
