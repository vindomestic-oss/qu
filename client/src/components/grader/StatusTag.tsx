import type { GradingParticipantStatus } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';
import { CheckIcon, CircleIcon, FlagIcon, PencilIcon } from './icons';

const ICONS: Record<GradingParticipantStatus, () => React.ReactNode> = {
  not_started: () => <CircleIcon />,
  answering: () => <PencilIcon />,
  needs_review: () => <FlagIcon />,
  graded: () => <CheckIcon />,
};

/** Icon + word, readable without colour; only "needs review" is a coloured tag. */
export function StatusTag({ status }: { status: GradingParticipantStatus }) {
  const { t } = useLanguage();
  return (
    <span className={`status-tag status-tag--${status}`}>
      {ICONS[status]()}
      <span>{t(`grader.status.${status}`)}</span>
    </span>
  );
}
