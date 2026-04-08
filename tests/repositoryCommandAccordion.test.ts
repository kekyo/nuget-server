// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import RepositoryCommandAccordion from '../src/ui/components/RepositoryCommandAccordion';

describe('repository command accordion', () => {
  test('renders the repository commands inside a collapsed accordion', () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryCommandAccordion, {
        title: 'Command examples',
        commands: [
          {
            command:
              'dotnet nuget add source "https://packages.example.com/v3/index.json"',
            copyAriaLabel: 'copy add-source command',
          },
          {
            command:
              'curl -X POST https://packages.example.com/api/publish \\\n  --data-binary "@Example.1.0.0.nupkg"',
            copyAriaLabel: 'copy publish command',
            preserveWhitespace: true,
          },
        ],
        onCopyCommand: vi.fn(),
      })
    );

    expect(html).toContain('Command examples');
    expect(html).toContain('dotnet nuget add source');
    expect(html).toContain('curl -X POST');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="copy add-source command"');
    expect(html).toContain('aria-label="copy publish command"');
  });
});
