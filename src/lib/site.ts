/** Site identity. Safe in client and server components.
 *  Override the name with NEXT_PUBLIC_SITE_NAME; a name ending in "IQ" renders as a two-tone wordmark. */

export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME?.trim() || "sportIQ";
export const SITE_TAGLINE = "Model-priced picks for every sport";
export const SITE_DESCRIPTION =
  "Calibrated forecasts for football, basketball, hockey, baseball and dirt racing, ranked by confidence and graded against the market in one ledger.";

/** Split the name for the wordmark: ["sport", "IQ"] or [name, ""]. */
export function wordmarkParts(name: string = SITE_NAME): [string, string] {
  return /IQ$/.test(name) ? [name.slice(0, -2), "IQ"] : [name, ""];
}
