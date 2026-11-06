# @lp-labs/migration-planner

Dependency-aware migration planning with explicit dry runs, sequential execution and partial
failure receipts. Independently authored; zero runtime or peer dependencies.

## Install

```bash
npm install @lp-labs/migration-planner
```

ES2022, ESM/CommonJS and TypeScript declarations. CommonJS can load all exports with
`require('@lp-labs/migration-planner')`. Actual migration effects belong to your adapter.

## Quickstart

```js
import { createPlanner, executePlan } from '@lp-labs/migration-planner';

const planner = createPlanner([
  { id: 'users', description: 'Create user storage' },
  { id: 'profiles', dependsOn: ['users'] },
  { id: 'audit' },
]);
const plan = planner.plan({ targets: ['profiles'] });
const preview = await executePlan(plan, () => {
  throw new Error('Dry runs must not invoke this');
});
if (preview.map((row) => row.id).join(',') !== 'users,profiles') {
  throw new Error('Incorrect prerequisites');
}
```

## Definitions and planning

`createPlanner(migrations: Iterable<Migration>, options?: PlannerOptions): Planner`

Each migration has:

- `id`: unique nonempty string, maximum 256 UTF-16 units.
- `dependsOn?`: array of unique known migration IDs, default `[]`.
- `description?`: string up to 4096 units, default `''`.

Options are non-negative safe integers: `maxMigrations` defaults to `10000`; `maxEdges`
defaults to `100000`. Definitions are copied. Forward dependency references are supported.
Duplicate IDs/dependencies and unknown dependencies throw `TypeError`.

`planner.plan({ applied?: string[], targets?: string[] }): MigrationPlan`

- Omitted `targets` selects everything; `[]` selects nothing.
- Targets include their transitive prerequisites.
- `applied` defaults to `[]` and must contain unique known IDs with every prerequisite applied.
- Applied migrations are omitted from the resulting steps.
- `steps` and `applied`, including each step/dependency array, are frozen copies.

Kahn's iterative topological ordering uses FIFO-ready order: initial roots follow definition
order, and newly ready nodes follow dependency-release order. This is deterministic, but not a
globally lexicographic sort or a guarantee of original-order ties between all ready nodes.

Cycles throw `MigrationCycleError`. Its `blocked` array includes cyclic migrations **and**
downstream migrations blocked by those cycles; it is not a minimal cycle path.

## Execution and customization

`executePlan(plan, apply, { dryRun = true, signal? }): Promise<MigrationReceipt[]>`

`apply(migration, signal?)` may be synchronous or return a promise. Each callback finishes before
the next starts. Explicitly set `dryRun: false` to perform effects.
Receipts are `{ id, status: 'planned' | 'completed' }`.

```js
import { createPlanner, executePlan } from '@lp-labs/migration-planner';

const storage = new Set(['base']);
const plan = createPlanner([{ id: 'base' }, { id: 'index', dependsOn: ['base'] }]).plan({
  applied: ['base'],
});
const receipts = await executePlan(
  plan,
  async (migration) => {
    storage.add(migration.id); // Replace with an awaited database/storage operation.
  },
  { dryRun: false },
);
if (!storage.has('index') || receipts[0].status !== 'completed') {
  throw new Error('Migration was not applied');
}
```

Persist successful migration IDs in your own storage and pass them as `applied` on the next run.
Validate environment/authorization and acquire your own distributed lock before execution.
For transactional adapters, define transaction boundaries explicitly; this library does not
silently assume a callback is atomic or durable.

## Failure and cancellation

- Only plans issued by the **same module instance** are executable; serialized or foreign
  ESM/CommonJS-instance plans are rejected. Recreate a plan from trusted definitions/history.
- Invalid callback/dry-run inputs throw `TypeError`.
- An already-aborted native `AbortSignal` rejects with its abort reason before any receipts.
- Cancellation is checked between steps and passed to the callback. In-flight work must
  cooperate; the planner cannot undo it or force an uncooperative promise to settle.
- Callback errors or between-step aborts throw `MigrationExecutionError` with `failedId`,
  frozen completed/planned `receipts` and the original `cause`.
- Later steps do not run after failure. The failing callback may already have changed storage.
  Receipts are not proof that storage committed.

## Types, performance and scope

Exported types: `Migration`, `PlannerOptions`, `MigrationPlan`, `PlanOptions`, `ExecuteOptions`,
`MigrationReceipt`, `Planner`. Runtime exports: `createPlanner`, `executePlan`,
`MigrationCycleError`, `MigrationExecutionError`.

Construction and planning are O(V + E), using O(V + E) storage. Execution is sequential O(S)
plus callback work. Iterative graph traversal avoids recursive call-stack growth.
No SQL generation, schema introspection, rollback, persistence, transaction handling, locking,
checksums or automatic exactly-once execution are included.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
