// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

import { describe, expect, test } from 'vitest';
import {
  createUploadFileSelection,
  type UploadFileSelectionFile,
} from '../src/ui/uploadFileSelection';

interface TestFile extends UploadFileSelectionFile {
  size: number;
}

const file = (name: string): TestFile => ({
  name,
  size: name.length,
});

describe('upload file selection', () => {
  test('should append dropped nupkg files to the current waiting list', () => {
    const currentFiles = [file('Existing.1.0.0.nupkg')];
    const incomingFiles = [file('Dropped.1.0.0.nupkg')];

    const result = createUploadFileSelection({
      currentFiles,
      incomingFiles,
      mode: 'append',
    });

    expect(
      result.selectedFiles.map((selectedFile) => selectedFile.name)
    ).toEqual(['Existing.1.0.0.nupkg', 'Dropped.1.0.0.nupkg']);
    expect(
      result.acceptedFiles.map((acceptedFile) => acceptedFile.name)
    ).toEqual(['Dropped.1.0.0.nupkg']);
    expect(result.invalidCount).toBe(0);
  });

  test('should replace the waiting list for browse selection', () => {
    const result = createUploadFileSelection({
      currentFiles: [file('Existing.1.0.0.nupkg')],
      incomingFiles: [file('Browsed.1.0.0.nupkg')],
      mode: 'replace',
    });

    expect(
      result.selectedFiles.map((selectedFile) => selectedFile.name)
    ).toEqual(['Browsed.1.0.0.nupkg']);
  });

  test('should ignore invalid files without removing current waiting files', () => {
    const result = createUploadFileSelection({
      currentFiles: [file('Existing.1.0.0.nupkg')],
      incomingFiles: [file('notes.txt')],
      mode: 'append',
    });

    expect(
      result.selectedFiles.map((selectedFile) => selectedFile.name)
    ).toEqual(['Existing.1.0.0.nupkg']);
    expect(result.acceptedFiles).toHaveLength(0);
    expect(result.invalidCount).toBe(1);
  });
});
