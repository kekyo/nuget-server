// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

/**
 * Resolves the post-login destination on the registry's origin.
 * @param page - Current login page URL.
 * @param requested - Root-relative path from the login URL, including any query and fragment.
 * @returns An absolute, same-origin URL, defaulting to the registry root.
 */
export const resolveLoginRedirect = (
  page: string,
  requested: string | null
): string => {
  const root = new URL('/', page);
  if (
    !requested?.startsWith('/') ||
    requested.startsWith('//') ||
    requested.includes('\\')
  )
    return root.href;
  try {
    const target = new URL(requested, root);
    if (target.origin === root.origin)
      return root.origin + target.pathname + target.search + target.hash;
  } catch {
    // Malformed destinations return the user to the registry.
  }
  return root.href;
};
