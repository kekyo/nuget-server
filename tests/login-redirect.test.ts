import { expect, it } from 'vitest';
import { resolveLoginRedirect } from '../src/ui/utils/loginRedirect.ts';

it('keeps login navigation on the registry origin and preserves local paths, queries and fragments', () => {
  const page = 'https://registry.example.test/prefix/login';
  const origin = new URL(page).origin;
  for (const value of [
    null,
    '',
    'relative',
    'https://elsewhere.example.test',
    '//elsewhere.example.test',
    '/\\elsewhere.example.test',
  ]) {
    expect(resolveLoginRedirect(page, value)).toBe(origin + '/');
  }
  expect(resolveLoginRedirect(page, '/prefix/packages?a=1#readme')).toBe(
    origin + '/prefix/packages?a=1#readme'
  );
  const normalized = resolveLoginRedirect(page, '/a/..//detail');
  expect(new URL(normalized).origin).toBe(origin);
});
