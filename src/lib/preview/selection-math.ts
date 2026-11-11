import {
  normalizeExtractedText,
  type NormalizationRules,
} from "../crawler/normalization";
import type { BoundingBox, PreviewElement } from "./types";

export function clientPointToDocumentCoords(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  docDimensions: { width: number; height: number }
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) {
    return { x: 0, y: 0 };
  }
  const relX = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  const relY = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);

  return {
    x: Math.round(relX * docDimensions.width),
    y: Math.round(relY * docDimensions.height),
  };
}

export function findDeepestElementAtPoint(
  elements: PreviewElement[],
  x: number,
  y: number
): PreviewElement | null {
  const hits = elements.filter((el) => {
    const b = el.boundingBox;
    return (
      x >= b.x &&
      x <= b.x + b.width &&
      y >= b.y &&
      y <= b.y + b.height
    );
  });

  if (hits.length === 0) {
    return null;
  }

  // Prefer deepest DOM node; break ties by smallest bounding box area
  hits.sort((a, b) => {
    const areaA = a.boundingBox.width * a.boundingBox.height;
    const areaB = b.boundingBox.width * b.boundingBox.height;
    if (Math.abs(areaA - areaB) > 24) {
      return areaA - areaB;
    }
    return b.metadata.domDepth - a.metadata.domDepth;
  });

  return hits[0];
}

export function computeUnionBoundingBox(
  elements: PreviewElement[]
): BoundingBox | null {
  if (elements.length === 0) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    const b = el.boundingBox;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.max(1, Math.round(maxX - minX)),
    height: Math.max(1, Math.round(maxY - minY)),
  };
}

export function boxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function findElementsIntersectingBox(
  elements: PreviewElement[],
  region: BoundingBox
): PreviewElement[] {
  return elements.filter((el) => boxesIntersect(el.boundingBox, region));
}

/**
 * Narrows region-intersecting elements to nodes predominantly inside the drawn box
 * and removes redundant descendants already covered by an untruncated container inside the box.
 */
export function filterRegionPreviewElements(
  elements: PreviewElement[],
  region: BoundingBox
): PreviewElement[] {
  const intersecting = findElementsIntersectingBox(elements, region);
  if (intersecting.length === 0) return [];

  const predominantlyInside = intersecting.filter((el) => {
    const b = el.boundingBox;
    const ix = Math.max(
      0,
      Math.min(b.x + b.width, region.x + region.width) - Math.max(b.x, region.x)
    );
    const iy = Math.max(
      0,
      Math.min(b.y + b.height, region.y + region.height) - Math.max(b.y, region.y)
    );
    const elArea = Math.max(1, b.width * b.height);
    return (ix * iy) / elArea >= 0.5;
  });

  const scoped = predominantlyInside.length > 0 ? predominantlyInside : intersecting;

  return scoped.filter((child) => {
    const childArea = child.boundingBox.width * child.boundingBox.height;
    return !scoped.some(
      (parent) =>
        parent.id !== child.id &&
        parent.metadata.domDepth < child.metadata.domDepth &&
        parent.boundingBox.width * parent.boundingBox.height > childArea &&
        parent.text.length > 0 &&
        parent.text.length < 300 &&
        Boolean(child.text) &&
        parent.text.includes(child.text)
    );
  });
}

export function normalizeTextSnippet(
  text: string,
  rules: NormalizationRules = {}
): string {
  return normalizeExtractedText(text, rules);
}
