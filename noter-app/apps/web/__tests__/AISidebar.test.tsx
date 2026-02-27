import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AISidebar } from '../components/AISidebar';

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

describe('AISidebar', () => {
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

    it('switches tabs', async () => {
        await act(async () => {
            render(<AISidebar />);
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /AI/i }));
        });
        
        await act(async () => {
            fireEvent.click(screen.getByText('Models'));
        });
        expect(screen.getByText('Search Hugging Face')).toBeInTheDocument();
        
        await act(async () => {
            fireEvent.click(screen.getByText('History'));
        });
        await waitFor(() => {
            expect(screen.getByText('Test Chat')).toBeInTheDocument();
        });
    });
});
