import { AGY_NOT_INSTALLED, agyHeldUntil, agyModels, agyStatus, agyUsage } from './agy.js';
import { CLAUDE_NOT_INSTALLED, claudeModels, claudeStatus, claudeUsage } from './claude.js';
import { usageHeldUntil } from './claudeLimit.js';
import { locateAgent } from './locate.js';
import type { AgentId, AgentModel, AgentStatus, UsageWindow } from './types.js';

/** What the harness takes from the app around it. */
export interface HarnessHost {
    /**
     * The binary the app names for the agent — from its settings, say. Empty or
     * absent, it is looked for where the agent's installer puts it, then on the PATH.
     */
    executable?(id: AgentId): string | undefined;
}

export interface AgentHarness {
    /** The binary a run of the agent would start: the one the app names, else the one found. Null when there is none. */
    locate(id: AgentId): string | null;

    /**
     * The models the agent offers, asked of it and reused for ten minutes, or
     * asked again when `refresh` is set. Rejects, saying why, when it cannot list
     * them: not installed, or not signed in.
     */
    models(id: AgentId, options?: { refresh?: boolean }): Promise<AgentModel[]>;

    /**
     * How much of the agent's plan is used, asked of it now. Empty when it reports
     * no limits, as for an API key. Rejects, saying why, when it cannot be asked.
     */
    usage(id: AgentId, options?: { signal?: AbortSignal }): Promise<UsageWindow[]>;

    /**
     * The agent's version, sign-in and usage, asked of it now. A check of it
     * already under way is joined rather than started again. Never rejects: what
     * went wrong is the detail.
     */
    status(id: AgentId): Promise<AgentStatus>;

    /** What the last check of the agent found, to show while the next one runs. Null before the first. */
    lastStatus(id: AgentId): AgentStatus | null;

    /**
     * The status the agent would have at `executable` — a path typed but not yet
     * saved, say; empty is the one found. Neither joins `status` nor is kept as
     * `lastStatus`. Never rejects for a known agent: what went wrong is the detail.
     */
    test(id: AgentId, executable: string): Promise<AgentStatus>;

    /**
     * When the usage limit the model draws on lifts, or 0 when it is free to go,
     * as far as the agent last said. Claude's limit belongs to the login, so it
     * holds every model alike; agy's belongs to a group of models.
     */
    heldUntil(id: AgentId, model: string): number;
}

const notInstalled = (id: AgentId): Error => new Error(id === 'claude' ? CLAUDE_NOT_INSTALLED : AGY_NOT_INSTALLED);

function known(id: string): asserts id is AgentId {
    if (id !== 'claude' && id !== 'agy') throw new Error(`There is no agent "${id}".`);
}

export function createAgentHarness(host: HarnessHost = {}): AgentHarness {
    const locate = (id: AgentId): string | null => {
        known(id);
        return host.executable?.(id)?.trim() || locateAgent(id);
    };

    const checking = new Map<AgentId, Promise<AgentStatus>>();
    const found = new Map<AgentId, AgentStatus>();

    return {
        locate,
        models: async (id, {refresh = false} = {}) => {
            const exe = locate(id);
            if (!exe) throw notInstalled(id);
            return id === 'claude' ? claudeModels(exe, refresh) : agyModels(exe, refresh);
        },
        usage: async (id, {signal} = {}) => {
            const exe = locate(id);
            if (!exe) throw notInstalled(id);
            return id === 'claude' ? claudeUsage(exe, signal) : agyUsage(exe, signal);
        },
        status: (id) => {
            try {
                known(id);
            } catch (e) {
                return Promise.reject(e);
            }
            const under = checking.get(id);
            if (under) return under;
            const exe = locate(id);
            const check = (id === 'claude' ? claudeStatus(exe) : agyStatus(exe))
                .then((status) => {
                    found.set(id, status);
                    return status;
                })
                .finally(() => checking.delete(id));
            checking.set(id, check);
            return check;
        },
        lastStatus: (id) => found.get(id) ?? null,
        test: async (id, executable) => {
            known(id);
            const exe = executable.trim() || locateAgent(id);
            return id === 'claude' ? claudeStatus(exe) : agyStatus(exe);
        },
        heldUntil: (id, model) => {
            known(id);
            return id === 'claude' ? usageHeldUntil() : agyHeldUntil(model);
        },
    };
}
