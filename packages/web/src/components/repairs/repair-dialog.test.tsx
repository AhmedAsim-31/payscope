import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RepairDialog } from './repair-dialog';

function setup(onConfirm = vi.fn()) {
  render(
    <RepairDialog
      title="Correct the entitlement?"
      description="desc"
      previous="Entitlement active"
      resulting="Entitlement expired"
      confirmLabel="Correct entitlement"
      isPending={false}
      error={null}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );
  return onConfirm;
}

const confirm = () => screen.getByRole('button', { name: 'Correct entitlement' });

describe('RepairDialog', () => {
  it('shows the previous and resulting state', () => {
    setup();
    const change = screen.getByLabelText('State change');
    expect(change).toHaveTextContent('Entitlement active');
    expect(change).toHaveTextContent('Entitlement expired');
  });

  it('keeps confirm disabled until the reason has at least 10 characters', async () => {
    const onConfirm = setup();
    expect(confirm()).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason'), 'too short');
    expect(confirm()).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason'), '!!');
    expect(confirm()).toBeEnabled();
    await userEvent.click(confirm());
    expect(onConfirm).toHaveBeenCalledWith('too short!!', expect.stringMatching(/^[0-9a-f-]{36}$/));
  });

  it('ignores whitespace padding when counting the reason', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('Reason'), '   short    ');
    expect(confirm()).toBeDisabled();
  });
});
