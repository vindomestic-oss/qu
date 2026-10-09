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
  /** The question's rubric (S11); null = none. */
  section_id: number | null;
  choices: Choice[];
  /** Text questions only, for graders (wish 8); never sent to participants. */
  reference_answer?: string | null;
  /** JSON array of accepted variants (filled by the Chidon answer keys; edited from S13). */
  accepted_answers?: string | null;
  grader_notes?: string | null;
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
  /** The quiz's rubrics in order (admin quiz payload only). */
  sections?: QuizSection[];
  /** A seeded Chidon quiz: deleting all its rubrics brings the standard ones back on the next server start. */
  seeded_rubrics?: boolean;
  questions?: Question[];
  /** Points a new question starts with (integers and halves). */
  default_points?: number;
  /** Sum of the questions' points (editor payload). */
  total_points?: number;
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
  /** The rubric; null = none. The editor always sends it. */
  section_id?: number | null;
  /** Text questions only; omitted keys keep the stored value. */
  reference_answer?: string;
  grader_notes?: string;
}

/** Name of a rubric with all 14 translations (the editor always sends every key). */
export interface SectionInput extends WithTranslationInputs<'name'> {
  name: string;
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
  graded_by?: string | null;
  grade_source?: string | null;
  grade_version?: number;
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

// --- Grading panel (wish 8) ---------------------------------------------------------------------

export type GradingParticipantStatus = 'not_started' | 'answering' | 'needs_review' | 'graded';

export interface GradingQuizMeta {
  id: number;
  title: string;
  question_count: number;
  total_points: number;
  base_language: QuizLang;
  offered_languages: QuizLang[];
}

export interface GradingSummary {
  session: { id: number; status: SessionStatus; started_at: string | null; ends_at: string | null };
  quiz: GradingQuizMeta;
  viewer: { kind: 'admin' | 'grader'; name: string };
  counters: {
    participants_joined: number;
    participants_answering: number;
    participants_submitted: number;
    answers_given: number;
    answers_possible: number;
    correct: number;
    incorrect: number;
    needs_review: number;
    awaiting_submission: number;
  };
  participants: {
    id: number;
    /** 1-based join order; graders see "Participant N" instead of a name. */
    number: number;
    /** Admins only. */
    display_name?: string;
    answered_count: number;
    needs_review_count: number;
    score: number;
    max_score: number;
    submitted_at: string | null;
    submit_source: string | null;
    status: GradingParticipantStatus;
  }[];
  questions: {
    id: number;
    sort_order: number;
    type: QuestionType;
    text: string;
    points: number;
    answered_count: number;
    correct_count: number;
    needs_review_count: number;
    correct_rate: number | null;
  }[];
}

export interface GradingChoice extends WithTranslations<'text'> {
  id: number;
  text: string;
  is_correct: number;
  sort_order: number;
}

export interface GradingQuestion extends WithTranslations<'text'> {
  id: number;
  sort_order: number;
  type: QuestionType;
  text: string;
  image_path: string | null;
  points: number;
  reference_answer: string | null;
  grader_notes: string | null;
  choices: GradingChoice[];
}

/** The grading fields of an answer (also the `current` of a 409 conflict). */
export interface AnswerGrade {
  id: number;
  is_correct: number | null;
  points_awarded: number | null;
  graded_at: string | null;
  graded_by: string | null;
  grade_source: string | null;
  grade_version: number;
}

export interface GradingAnswer extends AnswerGrade {
  text_answer?: string;
  selected_choice_ids?: number[];
}

export interface ParticipantReviewResponse {
  session: { id: number; status: SessionStatus; ends_at: string | null };
  quiz: GradingQuizMeta;
  participant: {
    id: number;
    number: number;
    display_name?: string;
    joined_at: string;
    submitted_at: string | null;
    submit_source: string | null;
    status: GradingParticipantStatus;
  };
  prev_id: number | null;
  next_id: number | null;
  gradable: boolean;
  totals: { score: number; max: number; needs_review: number; answered: number };
  items: { question: GradingQuestion; answer: GradingAnswer | null }[];
}

export interface WholeQuizQuestion {
  question: GradingQuestion;
  stats: {
    answered: number;
    correct: number;
    needs_review: number;
    awaiting_submission: number;
    no_answer: number;
    not_submitted_participants: number;
    choice_counts?: Record<string, number>;
  };
  answers: (GradingAnswer & { label: number })[];
}

export interface WholeQuizResponse {
  session: { id: number; status: SessionStatus; started_at: string | null; ends_at: string | null };
  quiz: GradingQuizMeta;
  filter: 'needs_review' | 'all';
  progress: { graded: number; total: number };
  questions: WholeQuizQuestion[];
}

export interface GraderLink {
  id: number;
  label: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}
