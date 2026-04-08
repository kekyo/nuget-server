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
