import { createPlanner, executePlan, type MigrationReceipt } from '@lp-labs/migration-planner';
const receipts: Promise<MigrationReceipt[]> = executePlan(createPlanner([]).plan(), () => {});
void receipts;
