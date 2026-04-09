// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

/**
 * Parses a nuspec tags string into individual tag values.
 * @param tags - Raw tags string from nuspec metadata
 * @returns Parsed tag list
 * @remarks Recognizes spaces, commas, and semicolons as delimiters.
 */
export const parseNuspecTags = (tags: string): string[] =>
  tags.split(/[\s,;]+/).filter((tag) => tag.length > 0);

const toArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const splitTargetFrameworkList = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

/**
 * Normalizes a target framework value found in nuspec metadata to a canonical TFM.
 * @param targetFramework - Raw target framework string from nuspec metadata
 * @returns Canonical target framework moniker when recognized, otherwise a normalized fallback value
 * @remarks
 * Handles the framework names commonly emitted in nuspec files such as
 * `.NETFramework4.5`, `.NETStandard2.0`, and `.NETCoreApp3.1`.
 */
export const normalizeNuspecTargetFramework = (
  targetFramework: string
): string => {
  const compact = targetFramework.trim().replace(/\s+/g, '');
  if (compact.length === 0) {
    return '';
  }

  const withoutLeadingDots = compact.replace(/^\.+/, '');
  const lowercase = withoutLeadingDots.toLowerCase();

  if (
    /^(net\d+(?:\.\d+)?(?:-[a-z0-9.-]+)?|netstandard\d+(?:\.\d+)?|netcoreapp\d+(?:\.\d+)?|netmf\d+(?:\.\d+)?|dotnet\d+(?:\.\d+)?|sl\d+(?:-[a-z0-9.-]+)?|wp\d+(?:\.\d+)?|wpa\d+(?:\.\d+)?|uap\d+(?:\.\d+)?)$/i.test(
      lowercase
    )
  ) {
    return lowercase;
  }

  const frameworkMatch = withoutLeadingDots.match(/^NETFramework(.+)$/i);
  if (frameworkMatch) {
    return `net${frameworkMatch[1]!.replace(/\./g, '')}`.toLowerCase();
  }

  const standardMatch = withoutLeadingDots.match(/^NETStandard(.+)$/i);
  if (standardMatch) {
    return `netstandard${standardMatch[1]!}`.toLowerCase();
  }

  const coreAppMatch = withoutLeadingDots.match(/^NETCoreApp(.+)$/i);
  if (coreAppMatch) {
    return `netcoreapp${coreAppMatch[1]!}`.toLowerCase();
  }

  const microFrameworkMatch = withoutLeadingDots.match(
    /^NETMicroFramework(.+)$/i
  );
  if (microFrameworkMatch) {
    return `netmf${microFrameworkMatch[1]!.replace(/\./g, '')}`.toLowerCase();
  }

  const dotnetMatch = withoutLeadingDots.match(/^NET(.+)$/i);
  if (dotnetMatch && /^\d/.test(dotnetMatch[1]!)) {
    return `net${dotnetMatch[1]!}`.toLowerCase();
  }

  return lowercase;
};

/**
 * Extracts normalized target frameworks from parsed nuspec metadata.
 * @param metadata - Parsed nuspec metadata section
 * @returns Distinct target framework monikers in encounter order
 * @remarks
 * Frameworks are collected from dependency groups, reference groups,
 * framework reference groups, and framework assembly declarations.
 */
export const extractNuspecTargetFrameworks = (
  metadata: Record<string, unknown>
): string[] => {
  const dependencyGroups = toArray(
    (metadata.dependencies as { group?: unknown } | undefined)?.group
  );
  const referenceGroups = toArray(
    (metadata.references as { group?: unknown } | undefined)?.group
  );
  const frameworkReferenceGroups = toArray(
    (metadata.frameworkReferences as { group?: unknown } | undefined)?.group
  );
  const frameworkAssemblies = toArray(
    (
      metadata.frameworkAssemblies as
        | { frameworkAssembly?: unknown }
        | undefined
    )?.frameworkAssembly
  );

  const rawTargetFrameworks = [
    ...dependencyGroups.flatMap((group) =>
      splitTargetFrameworkList(
        ((group as { $?: { targetFramework?: string } }).$?.targetFramework ??
          '') as string
      )
    ),
    ...referenceGroups.flatMap((group) =>
      splitTargetFrameworkList(
        ((group as { $?: { targetFramework?: string } }).$?.targetFramework ??
          '') as string
      )
    ),
    ...frameworkReferenceGroups.flatMap((group) =>
      splitTargetFrameworkList(
        ((group as { $?: { targetFramework?: string } }).$?.targetFramework ??
          '') as string
      )
    ),
    ...frameworkAssemblies.flatMap((frameworkAssembly) =>
      splitTargetFrameworkList(
        ((frameworkAssembly as { $?: { targetFramework?: string } }).$
          ?.targetFramework ?? '') as string
      )
    ),
  ];

  return [
    ...new Set(
      rawTargetFrameworks
        .map(normalizeNuspecTargetFramework)
        .filter((framework) => framework.length > 0)
    ),
  ];
};
