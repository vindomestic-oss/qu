import { CONTENT_LANGS, CONTENT_LANG_LABELS, type ContentLangCode } from '../../i18n/contentLanguages';

interface Props {
  values: Record<ContentLangCode, string>;
  onChange: (lang: ContentLangCode, value: string) => void;
  multiline?: boolean;
}

export function TranslationFields({ values, onChange, multiline }: Props) {
  const Field = multiline ? 'textarea' : 'input';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
      {CONTENT_LANGS.map((lang) => (
        <Field
          key={lang}
          value={values[lang]}
          onChange={(e) => onChange(lang, e.target.value)}
          placeholder={`${CONTENT_LANG_LABELS[lang]} (optional)`}
          style={{ fontSize: 12, padding: 4 }}
        />
      ))}
    </div>
  );
}
