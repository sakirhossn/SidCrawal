import { describe, expect, it } from "vitest";
import {
  clientPointToDocumentCoords,
  computeUnionBoundingBox,
  filterRegionPreviewElements,
  findDeepestElementAtPoint,
  findElementsIntersectingBox,
  normalizeTextSnippet,
} from "../selection-math";
import type { PreviewElement } from "../types";

const SAMPLE_ELEMENTS: PreviewElement[] = [
  {
    id: "el-0",
    selector: "section#pricing",
    tag: "section",
    text: "Pricing Plans Starter Pro",
    boundingBox: { x: 40, y: 100, width: 1000, height: 500 },
    metadata: {
      idAttr: "pricing",
      classes: [],
      role: null,
      ariaLabel: null,
      href: null,
      domDepth: 2,
    },
  },
  {
    id: "el-1",
    selector: "section#pricing > div:nth-of-type(2) > span",
    tag: "span",
    text: "$39 / month",
    boundingBox: { x: 420, y: 220, width: 140, height: 36 },
    metadata: {
      idAttr: null,
      classes: ["price"],
      role: null,
      ariaLabel: null,
      href: null,
      domDepth: 4,
    },
  },
  {
    id: "el-2",
    selector: "section#pricing > div:nth-of-type(2) > p",
    tag: "p",
    text: "Includes 100 monitors",
    boundingBox: { x: 420, y: 270, width: 220, height: 28 },
    metadata: {
      idAttr: null,
      classes: [],
      role: null,
      ariaLabel: null,
      href: null,
      domDepth: 4,
    },
  },
];

describe("selection-math", () => {
  it("maps scaled client pointer coordinates accurately to document pixels", () => {
    const pt = clientPointToDocumentCoords(
      320,
      200,
      { left: 0, top: 0, width: 640, height: 400 },
      { width: 1280, height: 800 }
    );
    expect(pt).toEqual({ x: 640, y: 400 });
  });

  it("picks the deepest/smallest element over outer container elements", () => {
    const hit = findDeepestElementAtPoint(SAMPLE_ELEMENTS, 450, 235);
    expect(hit?.id).toBe("el-1");
  });

  it("computes union bounding box and intersects visual region boxes", () => {
    const union = computeUnionBoundingBox([SAMPLE_ELEMENTS[1], SAMPLE_ELEMENTS[2]]);
    expect(union).toEqual({ x: 420, y: 220, width: 220, height: 78 });

    const inside = findElementsIntersectingBox(SAMPLE_ELEMENTS, {
      x: 410,
      y: 215,
      width: 240,
      height: 90,
    });
    expect(inside.map((e) => e.id)).toEqual(["el-0", "el-1", "el-2"]);

    const scoped = filterRegionPreviewElements(SAMPLE_ELEMENTS, {
      x: 410,
      y: 215,
      width: 240,
      height: 90,
    });
    expect(scoped.map((e) => e.id)).toEqual(["el-1", "el-2"]);
  });

  it("normalizes whitespace and dynamic numbers cleanly", () => {
    expect(
      normalizeTextSnippet("  Updated   12 minutes ago — $49.99  ", {
        collapseWhitespace: true,
        ignoreNumbers: true,
      })
    ).toBe("Updated # minutes ago — $#.#");
  });
});
