import { createContext } from 'react';

/** The id an answer row gives its answer text (AnswerText), so the row can name it in aria-describedby. */
export const AnswerTextIdContext = createContext<string | undefined>(undefined);
