/**
 * Alert evaluator module. The actual cron route lives in
 * apps/operator/app/api/cron/alert-evaluator/route.ts — that route loads
 * rules from the DB and calls `evaluateRule()` here for each one.
 *
 * Kept in @leadlandlord/agents (not the operator app) so the evaluator
 * logic is unit-testable without spinning up Next.js + a Sentry agent.
 */
export { evaluateRule, type RuleContext } from './evaluators';
