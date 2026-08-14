import type { CustomSiteAssessment, CustomSiteAssessmentBand } from './customsites-sanity';

/**
 * Shared scoring for the Custom Sites assessment quiz — used by the
 * AssessmentQuiz client component (instant result) AND re-run server-side by
 * /api/cs-lead's assessment kind (never trust a client-computed total).
 * Pure functions, no imports beyond types, so both bundles stay tiny.
 */

/** Total score for a set of answers (option index per question, -1 = unanswered). */
export function scoreAnswers(quiz: Pick<CustomSiteAssessment, 'questions'>, answers: number[]): number {
  return quiz.questions.reduce((sum, q, i) => {
    const idx = answers[i];
    if (idx == null || idx < 0) return sum;
    return sum + (q.options[idx]?.points ?? 0);
  }, 0);
}

/** The band a total score lands in. Bands are Studio-validated to be
 * contiguous from 0 through the max possible score; the last band absorbs
 * anything above its max as a safety net. */
export function bandForScore(
  quiz: Pick<CustomSiteAssessment, 'bands'>,
  score: number,
): CustomSiteAssessmentBand | null {
  const bands = [...quiz.bands].sort((a, b) => a.minScore - b.minScore);
  const match = bands.find((b) => score >= b.minScore && score <= b.maxScore);
  return match ?? bands[bands.length - 1] ?? null;
}

/** Max possible total — drives the progress denominator and band validation. */
export function maxScore(quiz: Pick<CustomSiteAssessment, 'questions'>): number {
  return quiz.questions.reduce((sum, q) => {
    const pts = q.options.map((o) => o.points);
    return sum + (pts.length ? Math.max(...pts) : 0);
  }, 0);
}
