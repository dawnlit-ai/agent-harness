// The public API. Listed explicitly rather than `export *`, so the package
// exposes only what it means to support; the `exports` map in package.json
// closes the deep-import path around it.

// The harness: each agent found, and asked for its models, usage and status.
export { createAgentHarness } from './harness.js';
export type { AgentHarness, HarnessHost } from './harness.js';

// What it answers in.
export { AGENT_IDS, AGENT_NAMES } from './types.js';
export type { AgentId, AgentModel, AgentStatus, UsageWindow } from './types.js';

// Finding an agent without a harness, and what to say when it is not there.
export { locateAgent } from './locate.js';
export type { LocateOptions } from './locate.js';
export { CLAUDE_NOT_INSTALLED, sdkExecutable } from './claude.js';
export { AGY_NOT_INSTALLED, agyQuotaGroup } from './agy.js';

// agy's model ids, read and chosen between.
export { AGY_LEVELS, resolveAgyChoice, splitAgyModelId } from './agyModels.js';
export type { AgyChoice } from './agyModels.js';

// Starting an agent's CLI, Windows' launcher scripts included.
export { agentEnv, killTree, runCommand, spawnAgent } from './command.js';
export type { CommandOptions, Exited, SpawnAgentOptions } from './command.js';
export { withToolPath } from './toolPath.js';

// Claude's usage limit, which belongs to the login rather than to one run.
export { clock, holdUsage, usageHeldUntil, usageLimit, waitForUsage } from './claudeLimit.js';
export type { UsageLimit } from './claudeLimit.js';

// A list asked of an agent, reused while it is fresh.
export { listCache } from './listCache.js';
export type { ListCache } from './listCache.js';
