/** Shared number and date formatting for the model UI. Safe in client and server components. */

export const pct = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;

/** Forecast probabilities should never round into a claim of certainty. */
export const probability = (value: number | null | undefined, digits = 0) => {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0 || value > 1) return "—";
  const rounded = (value * 100).toFixed(digits);
  const step = 10 ** -digits;
  if (Number(rounded) === 100) return `>${(100 - step).toFixed(digits)}%`;
  if (Number(rounded) === 0) return `<${step.toFixed(digits)}%`;
  return `${rounded}%`;
};

export const num = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);

export const signed = (value: number | null | undefined, digits = 1) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const text = Math.abs(value).toFixed(digits);
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
};

export const american = (price: number | null | undefined) => {
  if (price === null || price === undefined || !Number.isFinite(price)) return "—";
  return price > 0 ? `+${Math.round(price)}` : `${Math.round(price)}`;
};

export const fairAmerican = (probability: number | null | undefined) => {
  if (probability === null || probability === undefined || probability <= 0 || probability >= 1) return "—";
  return probability >= 0.5
    ? `${Math.round(-100 * probability / (1 - probability))}`
    : `+${Math.round(100 * (1 - probability) / probability)}`;
};

/** Sportsbook-style home handicap: negative means the home side is favored. */
export const spread = (handicap: number | null | undefined) => {
  if (handicap === null || handicap === undefined || !Number.isFinite(handicap)) return "—";
  if (handicap === 0) return "PK";
  return handicap > 0 ? `+${handicap}` : `${handicap}`;
};

export const units = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}u`;

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const longDateFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

export const shortDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const date = iso.length <= 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFmt.format(date);
};

export const longDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const date = iso.length <= 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : longDateFmt.format(date);
};

export const dateTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${dateTimeFmt.format(date)} ET`;
};

export const relativeAge = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
};

export const compact = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : new Intl.NumberFormat("en-US", { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
