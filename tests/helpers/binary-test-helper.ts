import { promises as fs } from 'fs';

/**
 * Check if buffer contains PNG file header
 * PNG magic number: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
 */
export const isPNGHeader = (buffer: Buffer): boolean => {
  if (buffer.length < 8) return false;
  return (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
};

/**
 * Check if buffer contains ICO file header
 * ICO header: 0x00 0x00 0x01 0x00
 */
export const isICOHeader = (buffer: Buffer): boolean => {
  if (buffer.length < 4) return false;
  return (
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0x01 &&
    buffer[3] === 0x00
  );
};

/**
 * Compare two binary files for equality
 */
export const compareBinaryFiles = async (
  file1Path: string,
  file2Path: string
): Promise<boolean> => {
  try {
    const buffer1 = await fs.readFile(file1Path);
    const buffer2 = await fs.readFile(file2Path);
    return buffer1.equals(buffer2);
  } catch (error) {
    return false;
  }
};

/**
 * Check if buffer contains UTF-8 replacement characters (0xEF 0xBF 0xBD)
 * This indicates binary data corruption when converted to string
 */
export const hasReplacementCharacters = (buffer: Buffer): boolean => {
  for (let i = 0; i <= buffer.length - 3; i++) {
    if (
      buffer[i] === 0xef &&
      buffer[i + 1] === 0xbf &&
      buffer[i + 2] === 0xbd
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Get file statistics for comparison
 */
export const getFileStats = async (filePath: string) => {
  try {
    const buffer = await fs.readFile(filePath);
    return {
      size: buffer.length,
      isPNG: isPNGHeader(buffer),
      isICO: isICOHeader(buffer),
      hasReplacementChars: hasReplacementCharacters(buffer),
      firstBytes: buffer.slice(0, 16).toString('hex'),
    };
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error}`);
  }
};
