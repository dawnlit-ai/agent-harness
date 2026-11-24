import { tmpdir } from 'node:os';
import { parseAgyModels } from './agyModels.js';
import { type Exited, runCommand } from './command.js';
import { listCache } from './listCache.js';
import type { AgentModel, AgentStatus, UsageWindow } from './types.js';

/**
 * The Antigravity CLI (`agy`), asked about itself: its models — Gemini, and the
 * Claude and GPT models beside it, each group on a quota of its own — whether it
 * is signed in, and how much of each quota is used.
 */

export const AGY_NOT_INSTALLED = 'Not installed: agy is neither where its installer puts it nor on the PATH.';

/** Long enough for `agy models` to ask Google over a slow connection. */
const LIST_TIMEOUT_MS = 60_000;

/** Long enough for a signed-in agy to answer each of a status check's questions. */
const STATUS_TIMEOUT_MS = 30_000;

/** Long enough for `/usage` to answer once agy is signed in; a signed-out agy waits a minute instead. */
const QUOTA_TIMEOUT_MS = 15_000;

/** What agy said went wrong: its last line, without the "Error:" in front. */
function complaint({code, stderr}: Exited): string {
    return stderr.trim().split('\n').at(-1)?.replace(/^Error:\s*/, '').trim() || `agy exited with ${code}.`;
}

/** Why agy could not be asked, from the error its start or its answer ended in. */
function unreachable(e: unknown, exe: string, timeoutMs: number): string {
    const error = e as NodeJS.ErrnoException;
    if (error.name === 'AbortError') return `agy did not answer within ${timeoutMs / 1000} seconds.`;
    if (error.code === 'ENOENT') return `Not found at ${exe}.`;
    return error.message;
}

const modelList = listCache<AgentModel[]>();

/** The models agy offers, or what agy says is in the way — not signed in, say. */
async function askForModels(exe: string, signal: AbortSignal): Promise<AgentModel[]> {
    const lines: string[] = [];
    const exited = await runCommand(exe, ['models'], {signal, onLine: (line) => lines.push(line)});
    if (exited.code !== 0) throw new Error(complaint(exited));
    const models = parseAgyModels(lines.join('\n'));
    if (models.length === 0) throw new Error('agy listed no models.');
    return models;
}

/** The models agy offers. Rejects, saying why, when it cannot list them. */
export function agyModels(exe: string, refresh = false): Promise<AgentModel[]> {
    return modelList.get(
        exe,
        () => askForModels(exe, AbortSignal.timeout(LIST_TIMEOUT_MS)).catch((e: unknown) => {
            throw new Error(unreachable(e, exe, LIST_TIMEOUT_MS));
        }),
        refresh,
    );
}

/** One group of models sharing a quota, as `agy -p /usage --output-format json` answers it. */
export interface QuotaGroup {
    /** "Gemini Models", "Claude and GPT models". */
    name?: string;
    /** "Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B". */
    description?: string;
    /** `disabled` while another window is used up: "the 5-hour limit does not currently apply". */
    buckets?: { window?: string; remaining_fraction?: number; reset_time?: string; disabled?: boolean }[];
}

interface UsageAnswer {
    command?: { data?: { groups?: QuotaGroup[] } };
}

/** The quota groups in what `/usage` printed. */
export function readQuota(output: string): QuotaGroup[] {
    let answer: UsageAnswer;
    try {
        answer = JSON.parse(output) as UsageAnswer;
    } catch {
        throw new Error('agy answered /usage with something other than JSON.');
    }
    return answer.command?.data?.groups ?? [];
}

/** "Gemini Models" is "Gemini", as what is said of it says it is about models. */
const groupName = (group: QuotaGroup): string => (group.name ?? 'Models').replace(/\s+models$/i, '');

/**
 * A reset time agy gave, or null for none. A window nothing has been used from
 * yet has no reset, which agy gives as the epoch.
 */
function resetOf(at: string | undefined): string | null {
    const time = Date.parse(at ?? '');
    return Number.isNaN(time) || time <= 0 ? null : at!;
}

/** Under this much of a window left, the quota is used up. */
const USED_UP = 0.005;

/** The groups `/usage` last answered with, to tell which one a model draws on. */
let quotaGroups: QuotaGroup[] = [];

/** When each group's quota comes back, by its name, while it is used up. */
const quotaHeld = new Map<string, number>();

/** Notes which groups are used up, and until when, for `agyHeldUntil`. */
export function noteQuota(groups: QuotaGroup[]): void {
    quotaGroups = groups;
    for (const group of groups) {
        if (!group.name) continue;
        // The latest reset among the windows used up: the quota is back only once each is.
        const back = (group.buckets ?? [])
            .filter((b) => typeof b.remaining_fraction === 'number' && b.remaining_fraction < USED_UP)
            .map((b) => Date.parse(resetOf(b.reset_time) ?? ''))
            .filter((at) => !Number.isNaN(at));
        if (back.length > 0) quotaHeld.set(group.name, Math.max(...back));
        else quotaHeld.delete(group.name);
    }
}

/** The group whose name or models name the model's family: `gemini`, `claude`, `gpt`. */
function groupOf(groups: QuotaGroup[], model: string): QuotaGroup | undefined {
    const family = model.split('-')[0]?.toLowerCase();
    if (!family) return undefined;
    return groups.find((g) => `${g.name ?? ''} ${g.description ?? ''}`.toLowerCase().includes(family));
}

/** When the quota the model draws on comes back, or 0 when it has some left, as far as agy last said. */
export function agyHeldUntil(model: string): number {
    const group = groupOf(quotaGroups, model)?.name;
    const until = (group && quotaHeld.get(group)) || 0;
    return until > Date.now() ? until : 0;
}

/** agy's windows, the shorter first. */
const USAGE_WINDOWS: [string, string][] = [['5h', '5 hours'], ['weekly', 'week']];

/** Each group's quota, as used rather than remaining so it reads like Claude's. */
export function quotaUsage(groups: QuotaGroup[]): UsageWindow[] {
    return groups.flatMap((group) =>
        USAGE_WINDOWS.flatMap(([window, named]) =>
            (group.buckets ?? [])
                .filter((b) => b.window === window && !b.disabled && typeof b.remaining_fraction === 'number')
                .map((b) => ({
                    label: `${groupName(group)} · ${named}`,
                    percentUsed: Math.round((1 - (b.remaining_fraction ?? 1)) * 100),
                    resetsAt: resetOf(b.reset_time),
                })),
        ),
    );
}

/**
 * agy's quota as it stands, which also tells `agyHeldUntil` which groups are
 * used up and until when. Ask it only of a signed-in agy: a signed-out one waits
 * a minute for a browser sign-in instead of answering.
 */
export async function agyUsage(exe: string, signal?: AbortSignal): Promise<UsageWindow[]> {
    const timeout = AbortSignal.timeout(QUOTA_TIMEOUT_MS);
    const lines: string[] = [];
    // Out of any folder of the user's, which agy would otherwise take for a project.
    const exited = await runCommand(exe, ['-p', '/usage', '--output-format', 'json'], {
        cwd: tmpdir(),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        onLine: (line) => lines.push(line),
    }).catch((e: unknown) => {
        throw new Error(unreachable(e, exe, QUOTA_TIMEOUT_MS));
    });
    if (exited.code !== 0) throw new Error(complaint(exited));
    const groups = readQuota(lines.join('\n'));
    noteQuota(groups);
    return quotaUsage(groups);
}

/** What `agy --version` says. */
async function askForVersion(exe: string, signal: AbortSignal): Promise<string | null> {
    const said: string[] = [];
    await runCommand(exe, ['--version'], {signal, onLine: (line) => said.push(line)});
    return said[0]?.trim() || null;
}

/** The binary a run would start, its version, whether it is signed in, and its quota. */
export async function agyStatus(exe: string | null): Promise<AgentStatus> {
    const base = {id: 'agy', name: 'Antigravity CLI', executable: exe ?? ''} as const;
    if (!exe) return {...base, version: null, ready: false, detail: AGY_NOT_INSTALLED, usage: []};
    const timeout = AbortSignal.timeout(STATUS_TIMEOUT_MS);
    // All three at once, as each takes a second or two. Only a signed-in agy lists
    // its models, and the quota is asked before that is known, so a model list that
    // fails stops the quota too, rather than leaving agy waiting on a browser sign-in.
    const signedOut = new AbortController();
    const version = askForVersion(exe, timeout);
    const models = askForModels(exe, timeout);
    const usage = agyUsage(exe, AbortSignal.any([timeout, signedOut.signal])).catch((): UsageWindow[] => []);
    try {
        const [said, offered] = await Promise.all([version, models]);
        modelList.set(exe, offered);
        const count = `${offered.length} model${offered.length === 1 ? '' : 's'} on offer`;
        return {...base, version: said, ready: true, detail: `Signed in · ${count}`, usage: await usage};
    } catch (e) {
        signedOut.abort();
        return {
            ...base,
            version: await version.catch(() => null),
            ready: false,
            detail: unreachable(e, exe, STATUS_TIMEOUT_MS),
            usage: [],
        };
    }
}
