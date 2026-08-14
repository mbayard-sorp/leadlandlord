import type { CsAssessmentBlock } from '@/lib/customsites-sanity';
import { AssessmentQuiz } from '../AssessmentQuiz';

interface Props {
  block: CsAssessmentBlock;
  siteKey: string;
}

/** Server wrapper for the quiz: the csAssessment doc (questions, bands,
 * stages) arrives fully deref'd from the pageBuilder projection; the client
 * component handles stepping, scoring, and lead capture. Renders nothing
 * without a referenced quiz or questions — no empty shell. */
export function AssessmentBlock({ block, siteKey }: Props) {
  const quiz = block.quiz;
  if (!quiz || !quiz.questions?.length || !quiz.bands?.length) return null;

  return (
    <section className="cs-section">
      <div className="cs-container cs-quiz">
        <AssessmentQuiz
          siteKey={siteKey}
          quiz={quiz}
          introHeading={block.introHeading ?? 'Where are you on the journey?'}
          introBody={block.introBody ?? null}
          startLabel={block.startLabel?.trim() || 'Start Assessment'}
          captureTiming={block.captureTiming ?? 'after-result'}
          resultCtaLabel={block.resultCtaLabel ?? null}
          resultCtaHref={block.resultCtaHref ?? null}
        />
      </div>
    </section>
  );
}
