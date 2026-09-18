import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Logo } from '../components/Logo';

export function Home() {
  const { t, isRtl } = useLanguage();
  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>
      <Logo />
      <LanguageSwitcher />
      <h1>{t('home.title')}</h1>
      <p>
        <Link to="/admin/login">Admin login</Link>
      </p>
      <p>
        <Link to="/join">{t('home.joinQuiz')}</Link>
      </p>
    </div>
  );
}
