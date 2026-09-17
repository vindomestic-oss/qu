import type { Language } from './translations';

/** Returns the `${field}_${language}` override if present, falling back to the original `${field}` value. */
export function resolveField(row: unknown, field: string, language: Language): string {
  const r = row as Record<string, unknown>;
  if (language !== 'en') {
    const override = r[`${field}_${language}`];
    if (typeof override === 'string' && override) return override;
  }
  return (r[field] as string) ?? '';
}
