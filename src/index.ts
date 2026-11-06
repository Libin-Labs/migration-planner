export interface Migration {
  id: string;
  dependsOn?: readonly string[];
  description?: string;
}
export interface PlannerOptions {
  maxMigrations?: number;
  maxEdges?: number;
}
export interface MigrationPlan {
  readonly steps: readonly Readonly<Required<Migration>>[];
  readonly applied: readonly string[];
}
export interface PlanOptions {
  applied?: readonly string[];
  targets?: readonly string[];
}
export interface ExecuteOptions {
  dryRun?: boolean;
  signal?: AbortSignal;
}
export interface MigrationReceipt {
  id: string;
  status: 'planned' | 'completed';
}
export class MigrationCycleError extends Error {
  constructor(readonly blocked: readonly string[]) {
    super(`Migration cycle blocks: ${blocked.join(', ')}`);
    this.name = 'MigrationCycleError';
  }
}
export class MigrationExecutionError extends Error {
  constructor(
    readonly failedId: string,
    readonly receipts: readonly MigrationReceipt[],
    cause: unknown,
  ) {
    super(`Migration failed at ${failedId}.`, { cause });
    this.name = 'MigrationExecutionError';
  }
}
export interface Planner {
  plan(options?: PlanOptions): MigrationPlan;
}
const issued = new WeakSet<MigrationPlan>();
function label(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256)
    throw new TypeError('Migration IDs must be nonempty strings up to 256 units.');
}
function maximum(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError('Capacities must be non-negative safe integers.');
  return value;
}
function unique(values: readonly string[], name: string): string[] {
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array.`);
  const result = Array.from(values);
  result.forEach(label);
  if (new Set(result).size !== result.length) throw new TypeError(`Duplicate ${name}.`);
  return result;
}
export function createPlanner(input: Iterable<Migration>, options: PlannerOptions = {}): Planner {
  const maxNodes = maximum(options.maxMigrations ?? 10_000),
    maxEdges = maximum(options.maxEdges ?? 100_000);
  if (input == null || typeof input[Symbol.iterator] !== 'function')
    throw new TypeError('Migrations must be iterable.');
  const nodes = new Map<string, Readonly<Required<Migration>>>();
  let edges = 0;
  for (const migration of input) {
    if (nodes.size === maxNodes) throw new RangeError('Migration capacity exceeded.');
    label(migration.id);
    if (nodes.has(migration.id)) throw new TypeError(`Duplicate migration: ${migration.id}`);
    const dependsOn = unique(migration.dependsOn ?? [], 'dependencies');
    edges += dependsOn.length;
    if (edges > maxEdges) throw new RangeError('Edge capacity exceeded.');
    const description = migration.description ?? '';
    if (typeof description !== 'string' || description.length > 4096)
      throw new TypeError('Invalid description.');
    nodes.set(
      migration.id,
      Object.freeze({ id: migration.id, dependsOn: Object.freeze(dependsOn), description }),
    );
  }
  const remaining = new Map<string, number>(),
    outputs = new Map<string, string[]>();
  for (const migration of nodes.values()) {
    remaining.set(migration.id, migration.dependsOn.length);
    for (const dependency of migration.dependsOn) {
      if (!nodes.has(dependency)) throw new TypeError(`Unknown dependency: ${dependency}`);
      const list = outputs.get(dependency) ?? [];
      list.push(migration.id);
      outputs.set(dependency, list);
    }
  }
  const ready = [...nodes.keys()].filter((id) => remaining.get(id) === 0);
  const order: string[] = [];
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index]!;
    order.push(id);
    for (const output of outputs.get(id) ?? []) {
      const next = remaining.get(output)! - 1;
      remaining.set(output, next);
      if (next === 0) ready.push(output);
    }
  }
  if (order.length !== nodes.size)
    throw new MigrationCycleError([...nodes.keys()].filter((id) => remaining.get(id)! > 0));
  return {
    plan(config = {}) {
      const applied = unique(config.applied ?? [], 'applied IDs');
      const done = new Set(applied);
      for (const id of done) {
        const node = nodes.get(id);
        if (!node) throw new TypeError(`Unknown applied migration: ${id}`);
        if (node.dependsOn.some((dependency) => !done.has(dependency)))
          throw new TypeError(`Applied migration lacks an applied prerequisite: ${id}`);
      }
      const selected = new Set<string>();
      const stack =
        config.targets === undefined ? [...nodes.keys()] : unique(config.targets, 'targets');
      while (stack.length) {
        const id = stack.pop()!;
        const node = nodes.get(id);
        if (!node) throw new TypeError(`Unknown target: ${id}`);
        if (selected.has(id)) continue;
        selected.add(id);
        for (const dependency of node.dependsOn) stack.push(dependency);
      }
      const plan: MigrationPlan = Object.freeze({
        steps: Object.freeze(
          order.filter((id) => selected.has(id) && !done.has(id)).map((id) => nodes.get(id)!),
        ),
        applied: Object.freeze([...applied]),
      });
      issued.add(plan);
      return plan;
    },
  };
}
export async function executePlan(
  plan: MigrationPlan,
  apply: (
    migration: Readonly<Required<Migration>>,
    signal?: AbortSignal,
  ) => void | PromiseLike<void>,
  options: ExecuteOptions = {},
): Promise<MigrationReceipt[]> {
  if (!issued.has(plan)) throw new TypeError('Expected a plan from this module instance.');
  if (typeof apply !== 'function') throw new TypeError('Expected an apply callback.');
  const dryRun = options.dryRun ?? true;
  if (typeof dryRun !== 'boolean') throw new TypeError('dryRun must be boolean.');
  options.signal?.throwIfAborted();
  const receipts: MigrationReceipt[] = [];
  for (const migration of plan.steps) {
    try {
      options.signal?.throwIfAborted();
      if (!dryRun) await apply(migration, options.signal);
      receipts.push({ id: migration.id, status: dryRun ? 'planned' : 'completed' });
    } catch (error) {
      throw new MigrationExecutionError(
        migration.id,
        Object.freeze(receipts.map((receipt) => Object.freeze({ ...receipt }))),
        error,
      );
    }
  }
  return receipts;
}
