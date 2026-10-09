import type { WithTranslations, WithTranslationInputs } from './i18n/contentLanguages';
import type { ContentLangCode, QuizLang } from './i18n/contentLanguages';

export type QuestionType = 'single' | 'multiple' | 'text';

export interface Choice extends WithTranslations<'text'> {
  id: number;
  question_id: number;
  text: string;
  is_correct: number;
  sort_order: number;
}

export interface Question extends WithTranslations<'text'> {
  id: number;
  quiz_id: number;
  sort_order: number;
  type: QuestionType;
  text: string;
  image_path: string | null;
  points: number;
  choices: Choice[];
}

export interface Quiz extends WithTranslations<'title'>, WithTranslations<'description'> {
  id: number;
  title: string;
  description: string | null;
  time_limit_seconds: number;
  base_language: QuizLang;
  /** Languages the author declared (base first). Participants see only declared, complete ones. */
  content_languages: QuizLang[];
  /** What participants are offered: declared and fully translated (admin quiz payload only). */
  offered_languages?: QuizLang[];
  /** Per translation language: question and choice texts still empty (admin quiz payload only). */
  missing_by_language?: Partial<Record<ContentLangCode, number>>;
  created_by: number;
  created_at: string;
  question_count?: number;
  questions?: Question[];
  /** The quiz's pending or running session, if any (list endpoint only). */
  open_session?: { id: number; status: 'pending' | 'active'; join_code: string; ends_at: string | null; joining_locked: number } | null;
}

export interface SessionQuizMeta {
  id: number;
  title: string;
  time_limit_seconds: number;
  question_count: number;
}

/** Which languages a quiz's questions are actually available in, computed server-side. */
export interface QuizLanguageInfo {
  base_language: QuizLang;
  offered_languages: QuizLang[];
}

export interface ChoiceInput extends WithTranslationInputs<'text'> {
  /** The existing choice this row edits; omitted for a new choice. Keeps saved answers valid. */
  id?: number;
  text: string;
  is_correct: boolean;
}

export interface QuestionInput extends WithTranslationInputs<'text'> {
  type: QuestionType;
  text: string;
  points: number;
  choices: ChoiceInput[];
}

export type SessionStatus = 'pending' | 'active' | 'ended';

export interface QuizSession {
  id: number;
  quiz_id: number;
  join_code: string;
  status: SessionStatus;
  started_at: string | null;
  ends_at: string | null;
  created_at: string;
  /** 1 while the host has locked joining (new names get JOINING_LOCKED). */
  joining_locked: number;
}

export interface Participant {
  id: number;
  session_id: number;
  display_name: string;
}

export interface MyAnswer {
  selected_choice_ids: number[];
  text_answer: string | null;
}

export interface ParticipantChoice extends WithTranslations<'text'> {
  id: number;
  question_id: number;
  text: string;
  sort_order: number;
}

/** An author-defined rubric (S11). Colour = position among the quiz's sections, modulo 6. */
export interface QuizSection extends WithTranslations<'name'> {
  id: number;
  name: string;
  sort_order: number;
}

export interface ParticipantQuestion extends WithTranslations<'text'> {
  id: number;
  quiz_id: number;
  sort_order: number;
  type: QuestionType;
  text: string;
  image_path: string | null;
  points: number;
  choices: ParticipantChoice[];
  myAnswer: MyAnswer | null;
  /** Rubric (S11); absent or null = no rubric. */
  section_id?: number | null;
}

export interface ResultsBreakdownItem {
  question: Question;
  answer: {
    selected_choice_ids: number[];
    text_answer: string | null;
    is_correct: number | null;
    points_awarded: number | null;
  } | null;
}

export interface ResultsResponse extends QuizLanguageInfo {
  scoredPoints: number;
  maxPoints: number;
  pendingGrading: number;
  breakdown: ResultsBreakdownItem[];
}

export interface SessionParticipant {
  id: number;
  session_id: number;
  display_name: string;
  joined_at: string;
  submitted_at: string | null;
}

export interface SessionAnswer {
  id: number;
  session_id: number;
  question_id: number;
  participant_id: number;
  selected_choice_ids: string | null;
  text_answer: string | null;
  is_correct: number | null;
  points_awarded: number | null;
  graded_at: string | null;
  submitted_at: string;
}

export interface SessionResultsResponse {
  session: QuizSession;
  quiz: { id: number; title: string; time_limit_seconds: number };
  questions: Question[];
  participants: SessionParticipant[];
  answers: SessionAnswer[];
}

export interface LiveParticipant {
  id: number;
  display_name: string;
  joined_at: string;
  submitted_at: string | null;
  /** 1 while "Allow rejoin" is in effect: the name can be claimed without its secret. */
  rejoin_open: number;
  answered_count: number;
}

export interface LiveQuestion {
  id: number;
  sort_order: number;
  text: string;
  type: QuestionType;
  answered_count: number;
}

export interface LiveStatusResponse {
  session: QuizSession;
  participants: LiveParticipant[];
  questions: LiveQuestion[];
}
