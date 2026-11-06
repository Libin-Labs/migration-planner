import {
  createPlanner,
  executePlan,
  type MigrationPlan,
  MigrationCycleError,
  MigrationExecutionError,
} from '@lp-labs/migration-planner';
const plan: MigrationPlan = createPlanner([{ id: 'a' }]).plan();
await executePlan(plan, async (migration) => {
  const id: string = migration.id;
  void id;
});
// @ts-expect-error plan steps are immutable.
plan.steps.push({ id: 'b' });
void [MigrationCycleError, MigrationExecutionError];
