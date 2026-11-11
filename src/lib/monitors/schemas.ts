import { z } from "zod";

export const boundingBoxSchema = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().min(1),
  height: z.number().min(1),
});

export const viewportDimensionsSchema = z.object({
  width: z.number().int().min(320).max(1920),
  height: z.number().int().min(480).max(1200),
  deviceScaleFactor: z.number().min(1).max(3).default(1),
});

export const previewRenderRequestSchema = z.object({
  url: z.string().trim().min(1, "Enter a website URL.").max(2048),
  viewport: z
    .object({
      width: z.number().int().min(320).max(1920),
      height: z.number().int().min(480).max(1200),
    })
    .default({ width: 1280, height: 800 }),
});

export const createMonitorSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Monitor name is required.")
    .max(160, "Monitor name must be 160 characters or fewer."),
  url: z.string().trim().min(1, "Website URL is required.").max(2048),
  checkIntervalMinutes: z
    .number()
    .int()
    .min(5, "Minimum interval is 5 minutes.")
    .max(10080, "Maximum interval is 10,080 minutes.")
    .default(60),
});

export const updateMonitorSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    status: z.enum(["draft", "active", "paused"]).optional(),
    checkIntervalMinutes: z.number().int().min(5).max(10080).optional(),
  })
  .refine(
    (val) =>
      val.name !== undefined ||
      val.status !== undefined ||
      val.checkIntervalMinutes !== undefined,
    { message: "Provide at least one field to update." }
  );

export const saveSelectionSchema = z
  .object({
    selectionType: z.enum(["element", "multi_element", "region"]),
    cssSelector: z.string().trim().max(1000).nullable(),
    selectors: z.array(z.string().trim().min(1).max(1000)).max(25).default([]),
    elementMetadata: z.record(z.string(), z.unknown()).default({}),
    boundingBox: boundingBoxSchema.nullable(),
    viewportDimensions: viewportDimensionsSchema,
    selectedText: z.string().max(10000).default(""),
    normalizationRules: z
      .object({
        collapseWhitespace: z.boolean().default(true),
        ignoreNumbers: z.boolean().default(false),
        stripTimestamps: z.boolean().default(false),
        ignoreRegexPatterns: z.array(z.string().max(120)).max(5).default([]),
        visualDiffThresholdPercent: z.number().min(0).max(100).default(0.5),
      })
      .default({
        collapseWhitespace: true,
        ignoreNumbers: false,
        stripTimestamps: false,
        ignoreRegexPatterns: [],
        visualDiffThresholdPercent: 0.5,
      }),
    activate: z.boolean().default(false),
  })
  .refine(
    (val) => {
      if (val.selectionType === "region") {
        return val.boundingBox !== null;
      }
      return Boolean(val.cssSelector) || val.selectors.length > 0;
    },
    {
      message:
        "Select at least one DOM element or draw a bounding-box visual region before saving.",
    }
  );
