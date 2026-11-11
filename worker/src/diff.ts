import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { sha256Hex } from "../../src/lib/crawler/fingerprint.js";

export interface VisualComparisonResult {
  width: number;
  height: number;
  totalPixels: number;
  mismatchedPixels: number;
  diffPercentage: number;
  dimensionChanged: boolean;
  visualHash: string;
  diffPngBuffer: Buffer;
}

function copyOntoCanvas(src: PNG, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < src.height; y += 1) {
    const srcStart = y * src.width * 4;
    const srcEnd = srcStart + src.width * 4;
    const dstStart = y * width * 4;
    out.set(src.data.subarray(srcStart, srcEnd), dstStart);
  }
  return out;
}

/**
 * Compares two PNG screenshots pixel-by-pixel using `pixelmatch`, padding onto a union
 * canvas when element dimensions change between crawls, and renders a PNG diff mask.
 */
export function comparePngScreenshots(
  previousPngBuffer: Buffer,
  currentPngBuffer: Buffer,
  options: { pixelThreshold?: number } = {}
): VisualComparisonResult {
  const prevPng = PNG.sync.read(previousPngBuffer);
  const currPng = PNG.sync.read(currentPngBuffer);

  const width = Math.max(prevPng.width, currPng.width, 1);
  const height = Math.max(prevPng.height, currPng.height, 1);
  const dimensionChanged =
    prevPng.width !== currPng.width || prevPng.height !== currPng.height;

  const prevData =
    prevPng.width === width && prevPng.height === height
      ? prevPng.data
      : copyOntoCanvas(prevPng, width, height);
  const currData =
    currPng.width === width && currPng.height === height
      ? currPng.data
      : copyOntoCanvas(currPng, width, height);

  const diffPng = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(
    prevData,
    currData,
    diffPng.data,
    width,
    height,
    {
      threshold: options.pixelThreshold ?? 0.12,
      includeAA: false,
      diffColor: [239, 68, 68],
      diffColorAlt: [16, 185, 129],
    }
  );

  const totalPixels = width * height;
  const diffPercentage = Number(
    ((mismatchedPixels / totalPixels) * 100).toFixed(2)
  );

  return {
    width,
    height,
    totalPixels,
    mismatchedPixels,
    diffPercentage,
    dimensionChanged,
    visualHash: sha256Hex(Buffer.from(currPng.data)),
    diffPngBuffer: PNG.sync.write(diffPng),
  };
}

export function hashPngBuffer(pngBuffer: Buffer): string {
  const decoded = PNG.sync.read(pngBuffer);
  return sha256Hex(Buffer.from(decoded.data));
}
