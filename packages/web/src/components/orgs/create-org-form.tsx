'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import { createOrgBodySchema, orgSchema } from '@payscope/shared/org-schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api-client';
import { describeError } from '@/lib/api-messages';
import { rememberOrgId } from '@/lib/last-org';
import { SLUG_MAX_LENGTH, suggestSlug } from '@/lib/slug';

export function CreateOrgForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);

  const create = useMutation({
    mutationFn: async (body: { name: string; slug: string }) =>
      orgSchema.parse(
        await apiFetch('/api/v1/orgs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ),
    onSuccess: async (org) => {
      rememberOrgId(org.id);
      await queryClient.invalidateQueries({ queryKey: ['orgs'] });
      router.push(`/app/${org.id}`);
    },
  });

  const parsed = createOrgBodySchema.safeParse({ name, slug });
  const isBusy = create.isPending || create.isSuccess;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parsed.success || isBusy) return;
    create.mutate(parsed.data);
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" aria-busy={isBusy}>
      <div className="grid gap-2">
        <Label htmlFor="org-name">Name</Label>
        <Input
          id="org-name"
          name="name"
          autoComplete="organization"
          required
          maxLength={100}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugEdited) setSlug(suggestSlug(event.target.value));
          }}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="org-slug">Slug</Label>
        <Input
          id="org-slug"
          name="slug"
          required
          minLength={3}
          maxLength={SLUG_MAX_LENGTH}
          pattern="[a-z0-9\-]{3,48}"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="org-slug-hint"
          value={slug}
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(event.target.value);
          }}
        />
        <p id="org-slug-hint" className="text-muted-foreground text-xs">
          3 to 48 characters: lowercase letters, numbers, and hyphens.
        </p>
      </div>
      <p role="alert" className="text-destructive min-h-5 text-sm">
        {create.isError ? describeError(create.error, 'create-org') : null}
      </p>
      <Button type="submit" disabled={isBusy || !parsed.success}>
        {isBusy ? 'Creating...' : 'Create organization'}
      </Button>
    </form>
  );
}
