// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, expect, test } from 'vitest';
import { createPackageListViewState } from '../src/ui/packageListViewState';

describe('package list view state', () => {
  test('should hide package accordions when an active filter has no matches', () => {
    const state = createPackageListViewState({
      filterText: 'missing-package',
      filteredPackageCount: 0,
      hasMorePackages: true,
    });

    expect(state.hasActiveFilter).toBe(true);
    expect(state.shouldShowNoFilterMatches).toBe(true);
    expect(state.shouldRenderPackageAccordions).toBe(false);
    expect(state.infiniteScrollHasMore).toBe(false);
  });

  test('should keep package accordions available when a filter has matches', () => {
    const state = createPackageListViewState({
      filterText: 'target',
      filteredPackageCount: 1,
      hasMorePackages: true,
    });

    expect(state.hasActiveFilter).toBe(true);
    expect(state.shouldShowNoFilterMatches).toBe(false);
    expect(state.shouldRenderPackageAccordions).toBe(true);
    expect(state.infiniteScrollHasMore).toBe(false);
  });

  test('should treat whitespace-only filter text as inactive', () => {
    const state = createPackageListViewState({
      filterText: '   ',
      filteredPackageCount: 0,
      hasMorePackages: true,
    });

    expect(state.hasActiveFilter).toBe(false);
    expect(state.shouldShowNoFilterMatches).toBe(false);
    expect(state.shouldRenderPackageAccordions).toBe(true);
    expect(state.infiniteScrollHasMore).toBe(true);
  });
});
