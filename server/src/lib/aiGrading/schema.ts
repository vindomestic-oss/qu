import { CONFIDENCES, isConfidence, isVerdict, RATIONALE_MAX_CHARS, VERDICTS, type GradeResult } from './types';

// Wish 7, layer B (S14): the structured answer every provider must return. Hand-written instead of
// zod (no new dependency). Structured output does not enforce lengths, so the limits are applied
// after parsing: enums lowercased defensively, rationale cut to 300 and answer_language to 8 chars.

export const GRADE_FIELDS = ['rationale', 'verdict', 'confidence', 'injection_suspected', 'answer_language'] as const;

/**
 * The same schema for the Gemini API's structured output (generationConfig.responseSchema, an
 * OpenAPI subset). rationale comes first, so the model explains before it decides.
 */
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    rationale: { type: 'STRING' },
    verdict: { type: 'STRING', enum: [...VERDICTS] },
    confidence: { type: 'STRING', enum: [...CONFIDENCES] },
    injection_suspected: { type: 'BOOLEAN' },
    answer_language: { type: 'STRING' },
  },
  required: [...GRADE_FIELDS],
  propertyOrdering: [...GRADE_FIELDS],
} as const;

const cut = (s: string, max: number) => [...s].slice(0, max).join('');

/** A validated result, or null when the value does not have the schema's shape. */
export function parseGradeResult(value: unknown): GradeResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.rationale !== 'string' || typeof v.answer_language !== 'string') return null;
  if (typeof v.injection_suspected !== 'boolean') return null;
  const verdict = typeof v.verdict === 'string' ? v.verdict.trim().toLowerCase() : null;
  const confidence = typeof v.confidence === 'string' ? v.confidence.trim().toLowerCase() : null;
  if (!isVerdict(verdict) || !isConfidence(confidence)) return null;
  return {
    rationale: cut(v.rationale.trim(), RATIONALE_MAX_CHARS),
    verdict,
    confidence,
    injection_suspected: v.injection_suspected,
    answer_language: cut(v.answer_language.trim(), 8),
  };
}

/** parseGradeResult of a JSON text (a model's output); null when it is not JSON or not the schema. */
export function parseGradeJson(text: string): GradeResult | null {
  try {
    return parseGradeResult(JSON.parse(text));
  } catch {
    return null;
  }
}
