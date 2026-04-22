import { Button } from '@mui/material';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import DataState from './DataState';

describe('DataState', () => {
  test('renders a live loading state', () => {
    render(
      <DataState
        variant="loading"
        title="Loading branches"
        description="Fetching branch locations."
      />
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Loading branches')).toBeInTheDocument();
    expect(screen.getByText('Fetching branch locations.')).toBeInTheDocument();
  });

  test('renders an empty state message', () => {
    render(
      <DataState
        variant="empty"
        title="No records"
        description="Upload a file to get started."
      />
    );

    expect(screen.getByText('No records')).toBeInTheDocument();
    expect(screen.getByText('Upload a file to get started.')).toBeInTheDocument();
  });

  test('renders an error action', () => {
    const onRetry = vi.fn();

    render(
      <DataState
        variant="error"
        title="Unable to load"
        description="Try again in a moment."
        action={<Button onClick={onRetry}>Retry</Button>}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
