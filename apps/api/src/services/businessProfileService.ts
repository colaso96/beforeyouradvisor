import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errorToLogString } from "../utils/errorLog.js";

type BusinessProfile = {
  display_name: string;
  industry: string;
  primary_activities: string[];
  ordinary_expenses: string[];
  gray_areas: string[];
  operational_context: string;
};

type ProfilesFile = {
  business_profiles: Record<string, BusinessProfile>;
};

export type BusinessProfileOption = {
  key: string;
  displayName: string;
  industry: string;
};

let cachedProfiles: Record<string, BusinessProfile> | null = null;

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function loadProfiles(): Record<string, BusinessProfile> {
  if (cachedProfiles) return cachedProfiles;

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    resolve(currentDir, "../../../../business_profiles.json"),
    resolve(process.cwd(), "business_profiles.json"),
  ];

  const filePath = candidatePaths.find((path) => existsSync(path));
  if (!filePath) {
    cachedProfiles = {};
    return cachedProfiles;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as ProfilesFile;
    cachedProfiles = parsed.business_profiles ?? {};
    return cachedProfiles;
  } catch (error) {
    console.error(`[analysis:profiles] failed to load business_profiles.json: ${errorToLogString(error)}`);
    cachedProfiles = {};
    return cachedProfiles;
  }
}

function matchProfile(businessType: string): { key: string; profile: BusinessProfile } | null {
  const profiles = loadProfiles();
  const entries = Object.entries(profiles);
  if (!entries.length) return null;

  const normalizedInput = normalize(businessType);
  if (!normalizedInput) return null;

  const exact = entries.find(([key, profile]) => {
    const aliases = [key, profile.display_name, profile.industry].map(normalize);
    return aliases.includes(normalizedInput);
  });
  if (exact) return { key: exact[0], profile: exact[1] };

  const fuzzy = entries.find(([key, profile]) => {
    const aliases = [key, profile.display_name, profile.industry].map(normalize);
    return aliases.some((alias) => alias.includes(normalizedInput) || normalizedInput.includes(alias));
  });
  if (fuzzy) return { key: fuzzy[0], profile: fuzzy[1] };

  return null;
}

export function buildBusinessContextPrompt(businessType: string): string[] {
  const matched = matchProfile(businessType);
  if (!matched) return [];

  const { key, profile } = matched;
  return [
    `Matched business profile key: ${key}.`,
    `The business is a ${profile.display_name}.`,
    `They primarily focus on ${profile.primary_activities.join(", ")}.`,
    `When evaluating expenses, keep in mind that ${profile.operational_context}.`,
    `Common ordinary expenses in this profile include ${profile.ordinary_expenses.join(", ")}.`,
    `Potential gray areas include ${profile.gray_areas.join(", ")}.`,
  ];
}

export function listBusinessProfileOptions(): BusinessProfileOption[] {
  return Object.entries(loadProfiles()).map(([key, profile]) => ({
    key,
    displayName: profile.display_name,
    industry: profile.industry,
  }));
}

export function isCanonicalBusinessProfileKey(input: string): boolean {
  const profiles = loadProfiles();
  return Object.prototype.hasOwnProperty.call(profiles, input);
}
