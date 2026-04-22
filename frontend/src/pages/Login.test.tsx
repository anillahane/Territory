import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import Login from './Login';
import api from '../services/api';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../services/api', () => ({
  default: {
    login: vi.fn(),
  },
}));

describe('Login page', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    vi.mocked(api.login).mockReset();
  });

  test('submits credentials and redirects on success', async () => {
    vi.mocked(api.login).mockResolvedValue({
      accessToken: 'token',
      refreshToken: 'refresh',
      user: { id: '1', email: 'admin@example.com', role: 'admin' },
    });

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'Admin123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(api.login).toHaveBeenCalledWith('admin@example.com', 'Admin123!');
    });
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });

  test('shows the backend error message on failure', async () => {
    vi.mocked(api.login).mockRejectedValue(new Error('Invalid email or password'));

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrongpass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
