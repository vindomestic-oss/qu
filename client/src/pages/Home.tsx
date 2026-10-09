import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { UiLanguageMenu } from '../components/UiLanguageMenu';
import { Logo } from '../components/Logo';

export function Home() {
  const { t, isRtl } = useLanguage();
  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} style={{ maxWidth: 480, margin: '24px auto', textAlign: 'center' }}>
      <Logo />
      <UiLanguageMenu />
      <h1>{t('home.title')}</h1>
      <p>
        <Link to="/admin/login">{t('home.adminLogin')}</Link>
      </p>
      <p>
        <Link to="/join">{t('home.joinQuiz')}</Link>
      </p>
    </div>
  );
}
