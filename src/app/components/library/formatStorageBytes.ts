// Decimal (SI) units, matching how Dropbox itself reports space.
export function formatStorageBytes(bytes: number): string {
  const n = Math.max(0, Math.round(bytes));
  if (n < 1000) return `${n} ${n === 1 ? "byte" : "bytes"}`;
  if (n < 1e6) return `${Math.round(n / 1e3)} KB`;
  if (n < 1e9) {
    const mb = n / 1e6;
    return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }
  return `${(n / 1e9).toFixed(2)} GB`;
}
