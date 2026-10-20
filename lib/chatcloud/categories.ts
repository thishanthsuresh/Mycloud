// Categories used when creating a new user's initial category list.
export const CATEGORIES = [
  "Identity",
  "Finance",
  "Insurance",
  "Medical",
  "Education",
  "Work",
  "Legal",
  "Vehicle",
  "Housing",
  "Receipts",
  "Photos",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const isCategory = (value: unknown): value is Category =>
  typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);

export const CATEGORY_ICONS: Record<Category, string> = {
  Identity: "🪪",
  Finance: "🏦",
  Insurance: "🛡️",
  Medical: "🩺",
  Education: "🎓",
  Work: "💼",
  Legal: "⚖️",
  Vehicle: "🚗",
  Housing: "🏠",
  Receipts: "🧾",
  Photos: "🖼️",
  Other: "📄",
};

export const categoryIcon = (category: string): string =>
  isCategory(category) ? CATEGORY_ICONS[category] : CATEGORY_ICONS.Other;
