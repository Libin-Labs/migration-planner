import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createPlanner,
  executePlan,
  MigrationCycleError,
  MigrationExecutionError,
} from '../dist/esm/index.js';
test('dependency ordering is stable and all prerequisites precede outputs', () => {
  const plan = createPlanner([
    { id: 'c', dependsOn: ['a', 'b'] },
    { id: 'b' },
    { id: 'a' },
    { id: 'd', dependsOn: ['c'] },
  ]).plan();
  assert.deepEqual(
    plan.steps.map((value) => value.id),
    ['b', 'a', 'c', 'd'],
  );
});
test('target selection includes transitive dependencies and excludes unrelated work', () => {
  const planner = createPlanner([{ id: 'a' }, { id: 'b', dependsOn: ['a'] }, { id: 'c' }]);
  assert.deepEqual(
    planner.plan({ targets: ['b'] }).steps.map((value) => value.id),
    ['a', 'b'],
  );
  assert.deepEqual(planner.plan({ targets: [] }).steps, []);
  assert.deepEqual(
    planner.plan({ applied: ['a'], targets: ['b'] }).steps.map((value) => value.id),
    ['b'],
  );
});
test('applied migration history must be known, unique and dependency closed', () => {
  const planner = createPlanner([{ id: 'a' }, { id: 'b', dependsOn: ['a'] }]);
  for (const applied of [['b'], ['unknown'], ['a', 'a']])
    assert.throws(() => planner.plan({ applied }), TypeError);
  assert.throws(() => planner.plan({ targets: ['missing'] }), TypeError);
});
test('cycles report blocked nodes including downstream dependents', () => {
  assert.throws(
    () =>
      createPlanner([
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] },
        { id: 'c', dependsOn: ['a'] },
      ]),
    (error) => {
      assert.ok(error instanceof MigrationCycleError);
      assert.deepEqual(error.blocked, ['a', 'b', 'c']);
      return true;
    },
  );
  assert.throws(() => createPlanner([{ id: 'a', dependsOn: ['a'] }]), MigrationCycleError);
});
test('plans are frozen copies unaffected by later input mutation', () => {
  const input = [{ id: 'a', description: 'original' }];
  const plan = createPlanner(input).plan();
  input[0].description = 'changed';
  assert.equal(plan.steps[0].description, 'original');
  assert.throws(() => plan.steps.push({ id: 'b' }), TypeError);
  assert.throws(() => plan.steps[0].dependsOn.push('b'), TypeError);
});
test('execution defaults to dry run and actual callbacks execute sequentially', async () => {
  const plan = createPlanner([{ id: 'a' }, { id: 'b', dependsOn: ['a'] }]).plan(),
    calls = [];
  assert.deepEqual(
    (
      await executePlan(plan, () => {
        throw new Error('no');
      })
    ).map((value) => value.status),
    ['planned', 'planned'],
  );
  const result = await executePlan(
    plan,
    async (migration) => {
      calls.push(migration.id);
      await Promise.resolve();
    },
    { dryRun: false },
  );
  assert.deepEqual(calls, ['a', 'b']);
  assert.deepEqual(
    result.map((value) => value.status),
    ['completed', 'completed'],
  );
});
test('execution errors retain cause and completed receipts without running later steps', async () => {
  const plan = createPlanner([{ id: 'a' }, { id: 'b' }, { id: 'c' }]).plan(),
    cause = new Error('storage');
  await assert.rejects(
    executePlan(
      plan,
      (migration) => {
        if (migration.id === 'b') throw cause;
      },
      { dryRun: false },
    ),
    (error) => {
      assert.ok(error instanceof MigrationExecutionError);
      assert.equal(error.cause, cause);
      assert.equal(error.failedId, 'b');
      assert.deepEqual(error.receipts, [{ id: 'a', status: 'completed' }]);
      return true;
    },
  );
});
test('abort before and between migrations is explicit with partial receipts', async () => {
  const plan = createPlanner([{ id: 'a' }, { id: 'b' }]).plan(),
    controller = new AbortController(),
    reason = new Error('abort');
  controller.abort(reason);
  await assert.rejects(
    executePlan(plan, () => {}, { signal: controller.signal }),
    (error) => error === reason,
  );
  const during = new AbortController();
  await assert.rejects(
    executePlan(plan, () => during.abort(reason), { dryRun: false, signal: during.signal }),
    (error) => error.cause === reason && error.receipts.length === 1,
  );
});
test('invalid definitions, foreign plans and capacities fail explicitly', async () => {
  assert.throws(() => createPlanner([{ id: 'a' }, { id: 'a' }]), /Duplicate/);
  assert.throws(() => createPlanner([{ id: 'a', dependsOn: ['b'] }]), /Unknown/);
  assert.throws(() => createPlanner([{ id: 'a' }], { maxMigrations: 0 }), RangeError);
  assert.throws(() => createPlanner([{ id: 'a', dependsOn: ['a'] }], { maxEdges: 0 }), RangeError);
  const plan = createPlanner([]).plan();
  await assert.rejects(
    executePlan(JSON.parse(JSON.stringify(plan)), () => {}),
    /module instance/,
  );
});
test('large DAGs satisfy every dependency without recursion', () => {
  const nodes = Array.from({ length: 3000 }, (_, i) => ({
    id: String(i),
    dependsOn: i ? [String(i - 1)] : [],
  }));
  const plan = createPlanner(nodes).plan({ targets: ['2999'] });
  assert.equal(plan.steps.length, 3000);
  assert.equal(plan.steps.at(-1).id, '2999');
});
test('CommonJS plans and executes its own distributions', async () => {
  const api = createRequire(import.meta.url)('../dist/cjs/index.js');
  assert.deepEqual(await api.executePlan(api.createPlanner([{ id: 'a' }]).plan(), () => {}), [
    { id: 'a', status: 'planned' },
  ]);
});
