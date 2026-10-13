'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function PayloadViewer({ payload }: { payload: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(payload, null, 2);

  function copy() {
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }

  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium">Redacted payload</summary>
      <div className="grid gap-2 border-t p-4">
        <p className="text-muted-foreground text-xs">
          Personal and credential fields are masked on the server before this is sent to your
          browser.
        </p>
        <pre className="bg-muted max-h-96 overflow-auto rounded-md p-3 font-mono text-xs">
          {text}
        </pre>
        <div>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy payload'}
          </Button>
        </div>
      </div>
    </details>
  );
}
