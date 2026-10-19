import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar } from './filter-bar';

function renderBar(isFiltered = false) {
  render(
    <FilterBar
      label="Filter payments"
      fields={[{ name: 'status', label: 'Status', kind: 'select', options: ['failed'] }]}
      read={() => ''}
      isFiltered={isFiltered}
      onChange={vi.fn()}
      onApply={vi.fn()}
      onClear={vi.fn()}
    />,
  );
}

describe('FilterBar mobile disclosure', () => {
  it('starts collapsed and toggles the filter form from the Filters button', async () => {
    renderBar();
    const toggle = screen.getByRole('button', { name: 'Filters' });
    const form = screen.getByRole('search', { name: 'Filter payments' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', form.id);
    expect(form).toHaveClass('hidden', 'md:grid');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(form).not.toHaveClass('hidden');
  });

  it('flags active filters on the collapsed button', () => {
    renderBar(true);
    expect(screen.getByRole('button', { name: 'Filters (active)' })).toBeInTheDocument();
  });
});
