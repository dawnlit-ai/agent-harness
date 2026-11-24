import type { AccountInfo, Query, SDKControlGetUsageResponse, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { agentEnv, isLauncherScript, runCommand } from './command.js';
import { listCache } from './listCache.js';
import { launcherTarget } from './locate.js';
import type { AgentModel, AgentStatus, UsageWindow } from './types.js';

/**
 * Claude Code, asked about itself through the Claude Agent SDK: its models, who
 * it is signed in as, and its plan's usage. The SDK is the app's to install, and
 * is loaded only when Claude is asked something.
 */

/** Where to get Claude Code, which the app runs but does not ship. */
const INSTALL_URL = 'https://code.claude.com/docs/en/setup';

export const CLAUDE_NOT_INSTALLED = `Claude Code is not installed. Install it (${INSTALL_URL}), then run claude in a terminal and sign in.`;

/** Long enough for Claude Code's first start after it has updated itself. */
const TIMEOUT_MS = 30_000;

/**
 * The binary as the Agent SDK takes it. The SDK starts it directly, which Node
 * cannot do with a launcher script, so npm's `claude.cmd` is followed to the
 * program or `cli.js` it starts.
 */
export function sdkExecutable(exe: string): string {
    if (!isLauncherScript(exe)) return exe;
    const target = launcherTarget(exe);
    if (!target) throw new Error(`${exe} is a launcher script the Claude Agent SDK cannot start. Point the app at claude.exe instead.`);
    return target;
}

/** Asks the CLI something about itself, in a session that never runs a turn. */
async function askIdle<T>(exe: string, ask: (q: Query) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const {query} = await import('@anthropic-ai/claude-agent-sdk');

    // A prompt stream that never yields: the CLI answers control requests and is
    // closed before it runs anything, so asking costs nothing.
    let release = (): void => {
    };
    const held = new Promise<void>((resolve) => (release = resolve));

    async function* nothing(): AsyncGenerator<SDKUserMessage> {
        await held;
    }

    const q = query({
        prompt: nothing(),
        options: {
            // What a run is started with, so the answer is the one a run would get.
            pathToClaudeCodeExecutable: sdkExecutable(exe),
            env: agentEnv(),
            settingSources: [],
            strictMcpConfig: true,
            mcpServers: {},
            tools: [],
            persistSession: false,
        },
    });

    const stop = AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])]);
    let onStop = (): void => {
    };
    const stopped = new Promise<never>((_, reject) => {
        onStop = () => {
            const late = (stop.reason as Error | undefined)?.name === 'TimeoutError';
            reject(new Error(late ? `Claude Code did not answer within ${TIMEOUT_MS / 1000} seconds` : 'Cancelled'));
        };
        if (stop.aborted) onStop();
        else stop.addEventListener('abort', onStop, {once: true});
    });
    try {
        return await Promise.race([ask(q), stopped]);
    } finally {
        stop.removeEventListener('abort', onStop);
        release();
        q.close();
    }
}

const modelList = listCache<AgentModel[]>();

async function askForModels(exe: string): Promise<AgentModel[]> {
    const models = await askIdle(exe, (q) => q.supportedModels());
    return models.map((m) => ({
        id: m.value,
        label: m.displayName,
        description: m.description,
        ...(m.resolvedModel ? {resolvedModel: m.resolvedModel} : {}),
        efforts: m.supportsEffort ? [...(m.supportedEffortLevels ?? [])] : [],
    }));
}

/** The models the Claude login offers, asked of the CLI so the list never goes stale. */
export function claudeModels(exe: string, refresh = false): Promise<AgentModel[]> {
    return modelList.get(exe, () => askForModels(exe), refresh);
}

/** "2.1.288" from `claude --version`'s "2.1.288 (Claude Code)". */
async function versionOf(exe: string): Promise<string | null> {
    const said: string[] = [];
    try {
        const exited = await runCommand(exe, ['--version'], {
            signal: AbortSignal.timeout(TIMEOUT_MS),
            onLine: (line) => said.push(line),
        });
        if (exited.code !== 0) return null;
    } catch {
        return null;
    }
    return said[0]?.trim().split(/\s+/)[0] || null;
}

/** Who a run would be billed to, or null when it has nothing to sign its requests with. */
export function signedInAs(account: AccountInfo): string | null {
    if (account.email) return [`Signed in as ${account.email}`, account.subscriptionType].filter(Boolean).join(' · ');
    if (account.apiKeySource && account.apiKeySource !== 'none') return `Using an API key from ${account.apiKeySource}`;
    // Bedrock, Vertex and the rest sign requests with their own cloud credentials.
    if (account.apiProvider && account.apiProvider !== 'firstParty') return `Through ${account.apiProvider}`;
    return null;
}

/** The plan's limits that carry a figure, each as "<models> · <window>". None for an API key. */
export function planUsage(usage: SDKControlGetUsageResponse | null): UsageWindow[] {
    const limits = usage?.rate_limits;
    if (!limits) return [];
    type Limit = { utilization: number | null; resets_at: string | null } | null | undefined;
    const named: [string, Limit][] = [
        ['All models · 5 hours', limits.five_hour],
        ['All models · week', limits.seven_day],
        ['Opus · week', limits.seven_day_opus],
        ['Sonnet · week', limits.seven_day_sonnet],
        ...(limits.model_scoped ?? []).map((m): [string, Limit] => [`${m.display_name} · week`, m]),
    ];
    return named.flatMap(([label, limit]) =>
        limit && limit.utilization !== null
            ? [{label, percentUsed: limit.utilization, resetsAt: limit.resets_at}]
            : [],
    );
}

/** Experimental in the SDK, so a CLI that cannot answer it just shows no usage. */
const askUsage = (q: Query): Promise<SDKControlGetUsageResponse | null> =>
    q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({skipBehaviors: true}).catch(() => null);

/** The plan's usage as it stands. */
export async function claudeUsage(exe: string, signal?: AbortSignal): Promise<UsageWindow[]> {
    return planUsage(await askIdle(exe, askUsage, signal));
}

/** The binary a run would start, its version, whether it is signed in, and its plan's usage — asked as a run would. */
export async function claudeStatus(exe: string | null): Promise<AgentStatus> {
    const base = {id: 'claude', name: 'Claude Code', executable: exe ?? ''} as const;
    if (!exe) return {...base, version: null, ready: false, detail: CLAUDE_NOT_INSTALLED, usage: []};
    const asked = askIdle(exe, async (q) => {
        const account = await q.accountInfo();
        const usage = signedInAs(account) ? await askUsage(q) : null;
        return {account, usage};
    });
    const [version, answer] = await Promise.all([
        versionOf(exe),
        asked.catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))),
    ]);
    if (answer instanceof Error) {
        const missing = /ENOENT|not found/i.test(answer.message);
        return {
            ...base,
            version,
            ready: false,
            detail: missing ? `Not found at ${exe}.` : `It did not start: ${answer.message}`,
            usage: [],
        };
    }
    const who = signedInAs(answer.account);
    return {
        ...base,
        version,
        ready: who !== null,
        detail: who ?? 'Not signed in. Run claude in a terminal and sign in with /login.',
        usage: planUsage(answer.usage),
    };
}
