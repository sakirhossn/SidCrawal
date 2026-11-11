import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email address is required.")
  .email("Enter a valid email address.");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be 128 characters or fewer.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
  next: z.string().optional(),
});

export const registerSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter your full name (at least 2 characters).")
    .max(120, "Full name must be 120 characters or fewer."),
  email: emailSchema,
  password: passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const verifyResendSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const updateSettingsSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters.")
    .max(120, "Full name must be 120 characters or fewer."),
  defaultCheckIntervalMinutes: z
    .number()
    .int()
    .min(5, "Minimum check interval is 5 minutes.")
    .max(10080, "Maximum check interval is 7 days (10,080 minutes)."),
  emailNotificationsEnabled: z.boolean(),
  weeklyDigestEnabled: z.boolean(),
  timezone: z.string().trim().min(1, "Timezone is required.").max(64),
  themePreference: z.enum(["light", "dark", "system"]),
});
