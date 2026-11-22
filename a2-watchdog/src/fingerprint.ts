/** Normalised failure signature: step + error with numbers, ids and quoted values replaced. */
export function normalize(message: string): string {
  return message
    .toLowerCase()
    .replace(/'[^']*'|"[^"]*"|«[^»]*»/g, 'S')
    .replace(/\b[0-9a-f]{6,}\b/g, 'H')
    .replace(/\d+(\.\d+)?/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}
export function fingerprint(r: { step?: string; message?: string }): string {
  return `${r.step ?? '?'}|${normalize(r.message ?? '')}`;
}
