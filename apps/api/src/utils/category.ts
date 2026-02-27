function slugify(input: string): string {
  return input.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

const CANONICAL_BY_SLUG: Record<string, string> = {
  uncategorized: "Uncategorized",
  unknown: "Uncategorized",
  unspecified: "Uncategorized",
  none: "Uncategorized",
  other: "Uncategorized",

  meals: "Meals & Entertainment",
  meal: "Meals & Entertainment",
  entertainment: "Meals & Entertainment",
  "meals and entertainment": "Meals & Entertainment",
  "meals entertainment": "Meals & Entertainment",
  "meals and entertainment business": "Meals & Entertainment",
  "business meals": "Meals & Entertainment",
  "business meal": "Meals & Entertainment",
  "meals and entertainment category": "Meals & Entertainment",

  travel: "Travel",
  "business travel": "Travel",

  transportation: "Transportation",
  commuting: "Commuting",
  commute: "Commuting",
  "commuting transportation": "Commuting",
  "commuting travel": "Commuting",
  parking: "Transportation",
  fuel: "Transportation",
  "gas fuel": "Transportation",

  utilities: "Utilities",
  "internet utilities": "Utilities",

  "office supplies": "Office Supplies",

  "software subscription": "Software & Subscriptions",
  "saas subscription": "Software & Subscriptions",
  "saas subscriptions": "Software & Subscriptions",
  subscription: "Software & Subscriptions",
  "professional dues and subscriptions": "Software & Subscriptions",

  personal: "Personal",
  "personal goods": "Personal",
  "personal care": "Personal",
  "personal maintenance": "Personal",
  "personal living expense": "Personal",
};

export function normalizeCategory(input: string | null | undefined): string {
  if (!input || !input.trim()) return "Uncategorized";

  const slug = slugify(input);
  const mapped = CANONICAL_BY_SLUG[slug];
  if (mapped) return mapped;

  return input
    .replace(/[_/]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
