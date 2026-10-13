import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it('shows the status as text, not only as color', () => {
    render(<StatusBadge status="partially_refunded" />);
    expect(screen.getByText('Partially refunded')).toBeInTheDocument();
  });

  it('renders unknown statuses with their text', () => {
    render(<StatusBadge status="needs_review" />);
    expect(screen.getByText('Needs review')).toBeInTheDocument();
  });
});
