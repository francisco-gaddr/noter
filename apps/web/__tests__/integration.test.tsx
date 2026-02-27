import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { IconPicker } from '../components/IconPicker';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('Web Integration Tests', () => {
  it('renders IconPicker with shared icons', () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    
    render(<IconPicker onSelect={onSelect} onClose={onClose} />);
    
    expect(screen.getByText('iconPicker.title')).toBeInTheDocument();
    // Check for some icons from the new list
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(20);
  });
});
