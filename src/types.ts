/**
 * The shapes the harness answers in. Nothing here reaches Node, so a renderer
 * can import them, through `@dawnlit/agent-harness/models`, as well.
 */

/** The agent CLIs the harness knows: Claude Code (`claude`) and the Antigravity CLI (`agy`). */
export type AgentId = 'claude' | 'agy';

export const AGENT_IDS: readonly AgentId[] = ['claude', 'agy'];

/** What each agent is called where its status is shown. */
export const AGENT_NAMES: Readonly<Record<AgentId, string>> = {
    claude: 'Claude Code',
    agy: 'Antigravity CLI',
};

/** One model an agent offers. */
export interface AgentModel {
    /** What a run is started with, as `--model <id>`. Claude's are often aliases, such as `opus`. */
    id: string;
    /** "Opus", "Gemini 4 Argon". */
    label: string;
    /** What the agent says of it. Claude's only: agy says nothing. */
    description?: string;
    /** The model an alias stands for today, e.g. `claude-opus-5-5`. Claude's only. */
    resolvedModel?: string;
    /** The effort levels it takes, lowest first. Empty when it takes none. */
    efforts: string[];
    /** It has no default level, as agy's leveled models have none: a run names one. */
    effortRequired?: boolean;
}

/** One of a plan's usage limits, as the agent reports it. */
export interface UsageWindow {
    /** What the limit covers, e.g. "All models · 5 hours" or "Gemini · week". */
    label: string;
    /** How much of it is used, 0–100. */
    percentUsed: number;
    /** When it resets, as an ISO time. Null when the agent does not say. */
    resetsAt: string | null;
}

/** How one agent stands: found, which version, signed in, and how much of its plan is used. */
export interface AgentStatus {
    id: AgentId;
    name: string;
    /** The binary a run starts. Empty when none was found. */
    executable: string;
    /** What it says its version is. Null when it did not say. */
    version: string | null;
    /** Found and signed in, so a run on one of its models can start. */
    ready: boolean;
    /** Who it is signed in as, or what is in the way. */
    detail: string;
    /** The plan's limits and how much of each is used. Empty when the agent reports none, as for an API key. */
    usage: UsageWindow[];
}
