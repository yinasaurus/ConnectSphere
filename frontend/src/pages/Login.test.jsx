import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth';
import { api } from '../api';
import Login from './Login';

jest.mock('../api', () => ({
  api: jest.fn(),
}));

function unauthenticatedMe() {
  const err = new Error('Authentication required');
  err.status = 401;
  err.code = 'UNAUTHENTICATED';
  return Promise.reject(err);
}

function renderLogin() {
  return render(
        <MemoryRouter
          initialEntries={['/']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/app" element={<div>Coordinator dashboard</div>} />
          <Route path="/app/events" element={<div>Organiser dashboard</div>} />
          <Route path="/app/venues" element={<div>Venue dashboard</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

async function readyForm() {
  return screen.findByRole('heading', { name: /sign in/i });
}

describe('Login page', () => {
  beforeEach(() => {
    api.mockReset();
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return unauthenticatedMe();
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });
  });

  it('renders the login form', async () => {
    renderLogin();
    await readyForm();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('shows a validation error when fields are empty', async () => {
    const user = userEvent.setup();
    renderLogin();
    await readyForm();
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith('/api/auth/login', expect.anything());
  });

  it('shows an error message on invalid credentials', async () => {
    const user = userEvent.setup();
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return unauthenticatedMe();
      if (path === '/api/auth/login') {
        const err = new Error('Invalid email or password');
        err.status = 401;
        err.code = 'INVALID_CREDENTIALS';
        return Promise.reject(err);
      }
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    renderLogin();
    await readyForm();
    await user.type(screen.getByLabelText(/^email$/i), 'organiser@acme.example');
    await user.type(screen.getByLabelText(/^password$/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('redirects to the organiser dashboard after a successful login', async () => {
    const user = userEvent.setup();
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return unauthenticatedMe();
      if (path === '/api/auth/login') {
        return Promise.resolve({
          user: {
            id: 1,
            fullName: 'Aisha Rahman',
            email: 'organiser@acme.example',
            roles: ['EVENT_ORGANISER'],
            role: 'EVENT_ORGANISER',
          },
        });
      }
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    renderLogin();
    await readyForm();
    await user.type(screen.getByLabelText(/^email$/i), 'organiser@acme.example');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText('Organiser dashboard')).toBeInTheDocument();
  });

  it('shows a loading state while the request is pending', async () => {
    const user = userEvent.setup();
    let resolveLogin;
    api.mockImplementation((path) => {
      if (path === '/api/auth/me') return unauthenticatedMe();
      if (path === '/api/auth/login') {
        return new Promise((resolve) => {
          resolveLogin = resolve;
        });
      }
      return Promise.reject(new Error(`Unhandled api call: ${path}`));
    });

    renderLogin();
    await readyForm();
    await user.type(screen.getByLabelText(/^email$/i), 'organiser@acme.example');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const pending = screen.getByRole('button', { name: /signing in/i });
    expect(pending).toBeDisabled();

    resolveLogin({
      user: {
        id: 1,
        fullName: 'Aisha Rahman',
        email: 'organiser@acme.example',
        roles: ['EVENT_ORGANISER'],
        role: 'EVENT_ORGANISER',
      },
    });

    await waitFor(() => {
      expect(screen.getByText('Organiser dashboard')).toBeInTheDocument();
    });
  });
});
