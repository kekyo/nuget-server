// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

/**
 * Input values used to decide how the package list body should be rendered.
 */
export interface PackageListViewStateInput {
  /**
   * User-provided package filter text.
   */
  filterText: string;

  /**
   * Number of packages that currently match the filter.
   */
  filteredPackageCount: number;

  /**
   * Whether more unfiltered packages are available from the server.
   */
  hasMorePackages: boolean;
}

/**
 * Rendering decisions for the package list body.
 */
export interface PackageListViewState {
  /**
   * True when the user has entered a non-empty filter after trimming whitespace.
   */
  hasActiveFilter: boolean;

  /**
   * True when the empty-filter-result message should be shown.
   */
  shouldShowNoFilterMatches: boolean;

  /**
   * True when package accordions can be rendered.
   */
  shouldRenderPackageAccordions: boolean;

  /**
   * True when the infinite scroll component should request more packages.
   */
  infiniteScrollHasMore: boolean;
}

/**
 * Creates consistent rendering decisions for the package list body.
 *
 * @param input - Current package list filter and paging state.
 * @returns Rendering decisions shared by the package list UI.
 */
export const createPackageListViewState = (
  input: PackageListViewStateInput
): PackageListViewState => {
  const hasActiveFilter = input.filterText.trim().length > 0;
  const shouldShowNoFilterMatches =
    hasActiveFilter && input.filteredPackageCount === 0;

  return {
    hasActiveFilter,
    shouldShowNoFilterMatches,
    shouldRenderPackageAccordions: !shouldShowNoFilterMatches,
    infiniteScrollHasMore: input.hasMorePackages && !hasActiveFilter,
  };
};
