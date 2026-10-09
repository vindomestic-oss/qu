import { LANGUAGES, type Language } from '../i18n/translations';

function labelFor(code: Language): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

interface Props {
  languages: Language[];
  value: Language;
  onChange: (lang: Language) => void;
  label: string;
}

/** Picks the language quiz questions are shown in, restricted to languages this quiz actually offers. */
export function QuestionLanguageControl({ languages, value, onChange, label }: Props) {
  if (languages.length <= 1) {
    return (
      <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
        {label} {labelFor(languages[0] ?? value)}
      </span>
    );
  }

  return (
    <label style={{ fontSize: 14 }}>
      {label}{' '}
      <select value={value} onChange={(e) => onChange(e.target.value as Language)} style={{ padding: '4px 8px', fontSize: 14 }}>
        {languages.map((code) => (
          <option key={code} value={code}>
            {labelFor(code)}
          </option>
        ))}
      </select>
    </label>
  );
}
