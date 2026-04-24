// nuget-server - NuGet server on Node.js
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// License under MIT.

/**
 * File selection mode used by the upload drawer.
 */
export type UploadFileSelectionMode = 'replace' | 'append';

/**
 * Minimum file information required to build the upload waiting list.
 */
export interface UploadFileSelectionFile {
  /**
   * Name of the selected file.
   */
  name: string;
}

/**
 * Input values used to update the upload waiting list.
 */
export interface UploadFileSelectionInput<
  TFile extends UploadFileSelectionFile,
> {
  /**
   * Files that are already waiting for upload.
   */
  currentFiles: readonly TFile[];

  /**
   * Files selected by the latest browse or drop operation.
   */
  incomingFiles: readonly TFile[];

  /**
   * Whether valid incoming files replace or append to the current list.
   */
  mode: UploadFileSelectionMode;
}

/**
 * Result of applying an upload file selection operation.
 */
export interface UploadFileSelectionResult<
  TFile extends UploadFileSelectionFile,
> {
  /**
   * Files that should be shown in the upload waiting list.
   */
  selectedFiles: TFile[];

  /**
   * Valid .nupkg files accepted from the incoming file list.
   */
  acceptedFiles: TFile[];

  /**
   * Number of incoming files excluded because they are not .nupkg files.
   */
  invalidCount: number;
}

/**
 * Creates the next upload waiting list from an incoming file selection.
 *
 * @param input - Current waiting files, incoming files, and update mode.
 * @returns Updated waiting list information and invalid file count.
 */
export const createUploadFileSelection = <
  TFile extends UploadFileSelectionFile,
>(
  input: UploadFileSelectionInput<TFile>
): UploadFileSelectionResult<TFile> => {
  const acceptedFiles = input.incomingFiles.filter((file) =>
    file.name.endsWith('.nupkg')
  );
  const invalidCount = input.incomingFiles.length - acceptedFiles.length;

  if (acceptedFiles.length === 0) {
    return {
      selectedFiles: [...input.currentFiles],
      acceptedFiles,
      invalidCount,
    };
  }

  return {
    selectedFiles:
      input.mode === 'append'
        ? [...input.currentFiles, ...acceptedFiles]
        : [...acceptedFiles],
    acceptedFiles,
    invalidCount,
  };
};
