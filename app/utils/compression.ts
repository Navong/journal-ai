// app/utils/compression.ts
import pako from 'pako';

/**
 * Compress a base64 string using gzip
 * Reduces storage size by ~70-80% while maintaining quality
 *
 * @param base64 - Base64 encoded audio data
 * @returns Gzip-compressed base64 string with version prefix
 */
export function compressBase64(base64: string): string {
  try {
    // Convert base64 to binary
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Compress with gzip (level 6 = good balance of speed vs compression)
    const compressed = pako.gzip(bytes, { level: 6 });

    // Convert compressed bytes back to base64
    let compressedBinary = '';
    for (let i = 0; i < compressed.length; i++) {
      compressedBinary += String.fromCharCode(compressed[i]);
    }

    const compressedBase64 = btoa(compressedBinary);

    // Add version prefix for backward compatibility
    return `v2:gz:${compressedBase64}`;
  } catch (error) {
    console.error('[compression] Failed to compress base64:', error);
    throw new Error('Compression failed');
  }
}

/**
 * Decompress a gzip-compressed base64 string
 * Handles both new (compressed) and old (uncompressed) formats
 *
 * @param data - Compressed base64 string (with version prefix) or legacy uncompressed base64
 * @returns Decompressed base64 string
 */
export function decompressBase64(data: string): string {
  try {
    // Check if data is compressed (has version prefix)
    if (data.startsWith('v2:gz:')) {
      // New format: compressed
      const compressedBase64 = data.substring(6); // Remove 'v2:gz:' prefix

      // Convert base64 to binary
      const binaryString = atob(compressedBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Decompress with gzip
      const decompressed = pako.ungzip(bytes);

      // Convert back to base64
      let decompressedBinary = '';
      for (let i = 0; i < decompressed.length; i++) {
        decompressedBinary += String.fromCharCode(decompressed[i]);
      }

      return btoa(decompressedBinary);
    } else {
      // Old format: uncompressed base64 (backward compatibility)
      return data;
    }
  } catch (error) {
    console.error('[compression] Failed to decompress base64:', error);
    throw new Error('Decompression failed');
  }
}

/**
 * Check if base64 string is compressed
 * @param data - Base64 string to check
 * @returns True if data has compression version prefix
 */
export function isCompressed(data: string): boolean {
  return data.startsWith('v2:gz:');
}

/**
 * Get compression stats for logging/debugging
 * @param original - Original base64 string
 * @param compressed - Compressed base64 string (with prefix)
 * @returns Compression statistics
 */
export function getCompressionStats(original: string, compressed: string) {
  const originalSize = original.length;
  const compressedSize = compressed.length;
  const reduction = ((1 - compressedSize / originalSize) * 100).toFixed(1);

  return {
    originalSize,
    compressedSize,
    reductionPercent: reduction,
    originalKB: (originalSize / 1024).toFixed(1),
    compressedKB: (compressedSize / 1024).toFixed(1),
  };
}
