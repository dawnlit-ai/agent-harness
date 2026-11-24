import type { AgentModel } from './types.js';

/**
 * agy's model ids, read and chosen between. Nothing here reaches Node, so a
 * renderer can use it as well.
 */

/** The levels `agy --effort` takes, lowest first. */
export const AGY_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

const LEVELS: readonly string[] = AGY_LEVELS;

/** `agy models` lists a leveled model once per level, as `<id>-<level>`. */
const LEVEL_SUFFIX = new RegExp(`^(.+)-(${AGY_LEVELS.join('|')})$`, 'i');

/** "Gemini 4 Argon (High)" and "Claude Sonnet 5.5 (High)" name the level too. */
const LEVEL_IN_NAME = /\s*\([^)]*\)\s*$/;

/** agy's coordinating models take no level, whatever their id ends with. */
const COORDINATOR = /orchestrator|coordinator/i;

/** A model id as `agy models` lists it, split into the model and the level it names, if any. */
export function splitAgyModelId(id: string): { model: string; effort?: string } {
    const trimmed = id.trim();
    const m = LEVEL_SUFFIX.exec(trimmed);
    return m ? {model: m[1]!, effort: m[2]!.toLowerCase()} : {model: trimmed};
}

/**
 * The models in what `agy models` prints: one line per model and level, as
 * `<id>\t<name>`. Each model comes back once, its levels as its efforts. A line
 * with no name is agy talking, as "Fetching available models..." is.
 */
export function parseAgyModels(output: string): AgentModel[] {
    const models = new Map<string, { label: string; efforts: string[] }>();
    for (const line of output.split(/\r?\n/)) {
        const [rawId = '', rawName = ''] = line.split('\t');
        const id = rawId.trim();
        const name = rawName.trim();
        if (!id || !name) continue;
        const {model, effort} = splitAgyModelId(id);
        const entry = models.get(model) ?? {
            label: (effort ? name.replace(LEVEL_IN_NAME, '') : name).trim() || model,
            efforts: [],
        };
        if (effort && !entry.efforts.includes(effort)) entry.efforts.push(effort);
        models.set(model, entry);
    }
    return [...models].map(([id, {label, efforts}]) => ({
        id,
        label,
        efforts: efforts.toSorted((a, b) => LEVELS.indexOf(a) - LEVELS.indexOf(b)),
        // agy refuses a model listed by level unless the run names one.
        effortRequired: efforts.length > 0,
    }));
}

/** What `agy --model` and `--effort` are given. Empty leaves it to agy. */
export interface AgyChoice {
    model: string;
    effort: string;
}

/** The level a model that must be given one is run at when the choice names none it takes. */
function defaultLevel(model: AgentModel): string {
    return model.efforts.includes('medium') ? 'medium' : (model.efforts[0] ?? '');
}

/** The first of `wanted` the model takes; else its default level when it needs one; else none. */
function levelFor(model: AgentModel, ...wanted: string[]): string {
    const taken = wanted.find((w) => w && model.efforts.includes(w));
    if (taken) return taken;
    return model.effortRequired ? defaultLevel(model) : '';
}

/**
 * A stored (model, effort) choice as `agy --model` and `--effort` take it,
 * against the models agy lists: an id stored with its level, as
 * `<id>-<level>`, is split into the two, and an effort the model does not take
 * is dropped rather than handed to agy to refuse. A model that must be given a
 * level and was chosen without one it takes runs at `medium`, or at its only one.
 * With no models to go by, the choice goes as it is.
 */
export function resolveAgyChoice(model: string, effort: string, models: readonly AgentModel[]): AgyChoice {
    const m = model.trim();
    const e = effort.trim().toLowerCase();
    if (!m) {
        // agy's own default model: an effort is kept if any model takes it.
        const valid = models.length > 0 ? models.some((x) => x.efforts.includes(e)) : LEVELS.includes(e) && e !== 'max';
        return {model: '', effort: valid ? e : ''};
    }
    const direct = models.find((x) => x.id === m);
    if (direct) return {model: direct.id, effort: levelFor(direct, e)};
    const split = splitAgyModelId(m);
    if (split.effort) {
        const base = models.find((x) => x.id === split.model);
        // The level the id was stored with gives way to one chosen beside it.
        if (base) return {model: base.id, effort: levelFor(base, e, split.effort)};
        return {model: m, effort: ''};
    }
    if (COORDINATOR.test(m)) return {model: m, effort: ''};
    return {model: m, effort: e};
}
