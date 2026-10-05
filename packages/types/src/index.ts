import { z } from "zod";
const text = z.string().trim().min(1).max(200);
const list = z.array(text).max(100);
export const candidateProfileSchema = z
  .object({
    name: text,
    email: z.union([z.email(), z.literal("")]).default(""),
    phone: z.string().trim().max(40).default(""),
    portfolioUrl: z
      .union([z.url({ protocol: /^https?$/ }), z.literal("")])
      .default(""),
    githubUrl: z
      .union([z.url({ protocol: /^https?$/ }), z.literal("")])
      .default(""),
    // Separate name parts for application forms; which part is "first" is your choice.
    firstName: z.string().trim().max(100).default(""),
    lastName: z.string().trim().max(100).default(""),
    linkedinUrl: z
      .union([z.url({ protocol: /^https?$/ }), z.literal("")])
      .default(""),
    currentCity: z.string().trim().max(100).default(""),
    country: z.string().trim().max(100).default(""),
    summary: z.string().trim().max(3000).default(""),
    currentTitle: text,
    yearsOfExperience: z.number().min(0).max(70),
    locations: list,
    remotePreference: z.boolean().nullable(),
    targetRoles: list.min(1),
    excludedRoles: list,
    minimumSalary: z.number().nonnegative().max(1_000_000_000).nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code"),
    noticePeriodDays: z.number().int().min(0).max(365).nullable(),
    workAuthorization: z.string().trim().max(500),
    skills: list.min(1),
    education: z
      .array(
        z.object({
          institution: text,
          qualification: text,
          year: z.number().int().min(1950).max(2100).nullable(),
        }),
      )
      .max(30),
    experience: z
      .array(
        z.object({
          company: text,
          title: text,
          details: z.string().trim().max(5000),
        }),
      )
      .max(50),
    projects: z
      .array(z.object({ name: text, details: z.string().trim().max(5000) }))
      .max(50),
  })
  .strict();
export type CandidateProfileInput = z.infer<typeof candidateProfileSchema>;
export type CandidateProfile = CandidateProfileInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
