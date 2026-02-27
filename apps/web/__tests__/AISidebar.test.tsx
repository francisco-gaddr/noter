import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    it('renders closed by default', () => {
        render(<AISidebar />);
        expect(screen.getByRole('button', { name: /AI/i })).toBeInTheDocument();
    });

    it('opens sidebar on click', () => {
        render(<AISidebar />);
        fireEvent.click(screen.getByRole('button', { name: /AI/i }));
        expect(screen.getByText('AI Assistant')).toBeInTheDocument();
    });

    it('switches tabs', async () => {
        render(<AISidebar />);
        fireEvent.click(screen.getByRole('button', { name: /AI/i }));
        
        fireEvent.click(screen.getByText('Models'));
        expect(screen.getByText('Search Hugging Face')).toBeInTheDocument();
        
        fireEvent.click(screen.getByText('History'));
        await waitFor(() => {
            expect(screen.getByText('Test Chat')).toBeInTheDocument();
        });
    });
});
