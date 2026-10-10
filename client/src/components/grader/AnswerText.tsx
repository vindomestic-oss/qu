import { useContext } from 'react';
import { AnswerTextIdContext } from './answerTextId';

/**
 * The answer itself inside an answer row (text or chosen options). It carries the id its row hands
 * down, so the row's description reads the answer when J/K/N move the focus to it (wish 8, S15).
 */
export function AnswerText({ children, dir }: { children: React.ReactNode; dir?: 'auto' }) {
  const id = useContext(AnswerTextIdContext);
  return (
    <p className="answer-row__text" id={id} dir={dir}>
      {children}
    </p>
  );
}
