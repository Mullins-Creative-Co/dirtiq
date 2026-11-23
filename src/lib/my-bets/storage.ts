/** Hosted saves must survive a server restart; local SQLite is for development only. */
export function betStorageError(hosted: boolean, persistent: boolean): string | null {
  return hosted && !persistent
    ? "Bets cannot be saved on this copy of the site. Open https://dirtiq-9h.vercel.app/bets to use persistent bet storage."
    : null;
}
