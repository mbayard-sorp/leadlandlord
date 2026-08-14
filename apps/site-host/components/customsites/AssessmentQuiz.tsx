'use client';

import { useState, type FormEvent } from 'react';
import type { CustomSiteAssessment } from '@/lib/customsites-sanity';
import { bandForScore, scoreAnswers } from '@/lib/customsites-assessment';

interface Props {
  siteKey: string;
  quiz: CustomSiteAssessment;
  introHeading: string;
  introBody?: string | null;
  startLabel: string;
  captureTiming: 'before-result' | 'after-result' | 'never';
  resultCtaLabel?: string | null;
  resultCtaHref?: string | null;
}

type Step =
  | { kind: 'intro' }
  | { kind: 'question'; index: number }
  | { kind: 'capture' } // before-result gate
  | { kind: 'result' };

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * The Wealth Journey quiz (~3.5KB): one question at a time, progress bar,
 * back/next, local scoring against the Sanity-authored bands, stage result,
 * and lead capture. The lead email (with score + answers) goes through
 * /api/cs-lead kind:"assessment", which re-scores server-side.
 *
 * Everything (question count, wording, points, bands) is author-owned in the
 * csAssessment document — nothing here hardcodes a question set.
 */
export function AssessmentQuiz({
  siteKey,
  quiz,
  introHeading,
  introBody,
  startLabel,
  captureTiming,
  resultCtaLabel,
  resultCtaHref,
}: Props) {
  const [step, setStep] = useState<Step>({ kind: 'intro' });
  const [answers, setAnswers] = useState<number[]>(() => quiz.questions.map(() => -1));
  const [leadStatus, setLeadStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');

  const total = quiz.questions.length;
  const score = scoreAnswers(quiz, answers);
  const band = bandForScore(quiz, score);
  const stage = band?.stage ?? null;

  function selectOption(qIndex: number, optIndex: number) {
    const next = [...answers];
    next[qIndex] = optIndex;
    setAnswers(next);
    if (qIndex + 1 < total) {
      setStep({ kind: 'question', index: qIndex + 1 });
    } else {
      setStep(captureTiming === 'before-result' ? { kind: 'capture' } : { kind: 'result' });
    }
  }

  async function submitLead(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setLeadStatus('submitting');
    try {
      const res = await fetch('/api/cs-lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'assessment',
          siteKey,
          assessmentSlug: quiz.slug,
          answers,
          firstName: String(data.get('firstName') ?? ''),
          lastName: String(data.get('lastName') ?? ''),
          email: String(data.get('email') ?? ''),
          phone: String(data.get('phone') ?? '') || undefined,
          company: String(data.get('company') ?? ''),
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (!res.ok || !body?.ok) throw new Error('request_failed');
      setLeadStatus('done');
      if (step.kind === 'capture') setStep({ kind: 'result' });
    } catch {
      setLeadStatus('error');
    }
  }

  if (step.kind === 'intro') {
    return (
      <div className="cs-quiz-card" style={{ textAlign: 'center' }}>
        <h2 className="cs-quiz-question">{introHeading}</h2>
        {introBody ? <p className="cs-lead">{introBody}</p> : null}
        <p style={{ marginTop: 'var(--cs-space-4)' }}>
          <button type="button" className="cs-btn cs-btn-primary" onClick={() => setStep({ kind: 'question', index: 0 })}>
            {startLabel}
          </button>
        </p>
        <p className="cs-quiz-meta" style={{ justifyContent: 'center' }}>
          <span>
            {total} questions · about {Math.max(1, Math.round(total / 4))} min
          </span>
        </p>
      </div>
    );
  }

  if (step.kind === 'question') {
    const q = quiz.questions[step.index]!;
    const answered = answers[step.index] ?? -1;
    return (
      <div>
        <div className="cs-quiz-meta">
          <span>
            Question {step.index + 1} of {total}
          </span>
          <span>{Math.round(((step.index + 1) / total) * 100)}%</span>
        </div>
        <div className="cs-quiz-progress" aria-hidden="true">
          <span style={{ width: `${((step.index + 1) / total) * 100}%` }} />
        </div>
        <div className="cs-quiz-card">
          <h2 className="cs-quiz-question">{q.prompt}</h2>
          {q.helpText ? <p className="cs-card-excerpt">{q.helpText}</p> : null}
          <div className="cs-quiz-options" role="radiogroup" aria-label={q.prompt}>
            {q.options.map((opt, oi) => (
              <button
                key={opt.label}
                type="button"
                role="radio"
                aria-checked={answered === oi}
                className="cs-quiz-option"
                onClick={() => selectOption(step.index, oi)}
              >
                <span className="cs-quiz-key" aria-hidden="true">
                  {OPTION_KEYS[oi] ?? oi + 1}
                </span>
                {opt.label}
              </button>
            ))}
          </div>
          <div className="cs-quiz-nav">
            {step.index > 0 ? (
              <button
                type="button"
                className="cs-btn cs-btn-secondary"
                onClick={() => setStep({ kind: 'question', index: step.index - 1 })}
              >
                Back
              </button>
            ) : (
              <span />
            )}
          </div>
        </div>
      </div>
    );
  }

  const leadForm =
    captureTiming !== 'never' && leadStatus !== 'done' ? (
      <form method="post" action="/api/cs-lead" onSubmit={submitLead} style={{ marginTop: 'var(--cs-space-4)' }}>
        <div className="cs-form-row">
          <div className="cs-form-field">
            <label className="cs-form-label" htmlFor="quiz-first">
              First Name<span className="cs-form-required"> *</span>
            </label>
            <input id="quiz-first" name="firstName" className="cs-form-input" required autoComplete="given-name" />
          </div>
          <div className="cs-form-field">
            <label className="cs-form-label" htmlFor="quiz-last">
              Last Name<span className="cs-form-required"> *</span>
            </label>
            <input id="quiz-last" name="lastName" className="cs-form-input" required autoComplete="family-name" />
          </div>
        </div>
        <div className="cs-form-row">
          <div className="cs-form-field">
            <label className="cs-form-label" htmlFor="quiz-email">
              Email<span className="cs-form-required"> *</span>
            </label>
            <input id="quiz-email" name="email" type="email" className="cs-form-input" required autoComplete="email" />
          </div>
          <div className="cs-form-field">
            <label className="cs-form-label" htmlFor="quiz-phone">
              Phone
            </label>
            <input id="quiz-phone" name="phone" type="tel" className="cs-form-input" autoComplete="tel" />
          </div>
        </div>
        <div className="cs-form-honeypot" aria-hidden="true">
          <label htmlFor="quiz-company">Company</label>
          <input id="quiz-company" name="company" tabIndex={-1} autoComplete="off" />
        </div>
        {leadStatus === 'error' ? (
          <p className="cs-form-message cs-form-message--error" role="alert">
            Something went wrong. Please try again.
          </p>
        ) : null}
        <button type="submit" className="cs-btn cs-btn-primary" disabled={leadStatus === 'submitting'}>
          {leadStatus === 'submitting'
            ? 'Sending…'
            : step.kind === 'capture'
              ? 'See my result'
              : 'Email my team about this result'}
        </button>
      </form>
    ) : null;

  if (step.kind === 'capture') {
    return (
      <div className="cs-quiz-card">
        <h2 className="cs-quiz-question">Almost there</h2>
        <p className="cs-card-excerpt">Tell us where to send your result and we&rsquo;ll show it right away.</p>
        {leadForm}
      </div>
    );
  }

  // result
  return (
    <div>
      <div className="cs-quiz-result-head">
        {stage ? (
          <span className="cs-quiz-stage-medallion" aria-hidden="true">
            {stage.order}
          </span>
        ) : null}
        <h2>{band?.resultHeading ?? stage?.title ?? 'Your result'}</h2>
      </div>
      <div className="cs-quiz-result-body">
        {stage?.summary ? <p className="cs-lead">{stage.summary}</p> : null}
        {stage?.nextStageTeaser ? (
          <div className="cs-quiz-next">
            <p>{stage.nextStageTeaser}</p>
          </div>
        ) : null}
        {resultCtaLabel && resultCtaHref ? (
          <p style={{ marginTop: 'var(--cs-space-4)' }}>
            <a href={resultCtaHref} className="cs-btn cs-btn-primary">
              {resultCtaLabel}
            </a>
          </p>
        ) : null}
        {captureTiming === 'after-result' && leadStatus !== 'done' ? leadForm : null}
        {leadStatus === 'done' ? (
          <p className="cs-form-message cs-form-message--success" role="status">
            Thanks — we&rsquo;ll follow up shortly.
          </p>
        ) : null}
      </div>
    </div>
  );
}
