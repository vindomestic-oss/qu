import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { Logo } from '../components/Logo';

export function Home() {
  const { t } = useLanguage();
  return (
    <div style={{ maxWidth: 480, margin: '24px auto', paddingInline: 16, textAlign: 'center' }}>
      <Logo />
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
