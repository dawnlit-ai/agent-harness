// Reading `agy models`, and choosing a (model, effort) pair agy will take.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseAgyModels, resolveAgyChoice, splitAgyModelId } from '../dist/agyModels.js';
import type { AgentModel } from '../dist/index.js';
import { AGY_MODELS } from './support.ts';

const models = parseAgyModels(AGY_MODELS);
const byId = (id: string): AgentModel | undefined => models.find((m) => m.id === id);

test('parseAgyModels: one entry per model, its levels as efforts, lowest first', () => {
    assert.deepEqual(byId('gemini-4-neon'), {
        id: 'gemini-4-neon',
        label: 'Gemini 4 Neon',
        efforts: ['low', 'medium', 'high', 'xhigh'],
        effortRequired: true,
    });
    assert.deepEqual(byId('claude-opus-5-5')?.efforts, ['low', 'medium', 'high']);
});

test('parseAgyModels: the order agy lists them in, with its chatter left out', () => {
    assert.deepEqual(models.map((m) => m.id), [
        'gemini-4-neon',
        'gemini-4-argon',
        'gemini-pro-orchestrator-neon',
        'gemini-pro-orchestrator',
        'gemini-3.8-flash',
        'claude-opus-5-5',
        'gpt-oss-120b',
    ]);
});

test('parseAgyModels: a model listed at one level still has to be run at it', () => {
    assert.deepEqual(byId('gpt-oss-120b'), {
        id: 'gpt-oss-120b',
        label: 'GPT-OSS 120B',
        efforts: ['medium'],
        effortRequired: true,
    });
});

test('parseAgyModels: a model listed without a level keeps its name and takes none', () => {
    assert.deepEqual(byId('gemini-pro-orchestrator-neon'), {
        id: 'gemini-pro-orchestrator-neon',
        label: 'Orchestrator (Neon)',
        efforts: [],
        effortRequired: false,
    });
});

test('parseAgyModels: Windows line endings and a blank output', () => {
    assert.deepEqual(parseAgyModels(AGY_MODELS.replaceAll('\n', '\r\n')), models);
    assert.deepEqual(parseAgyModels(''), []);
});

test('splitAgyModelId: the level an id ends with, and only a level', () => {
    assert.deepEqual(splitAgyModelId('gemini-4-argon-high'), {model: 'gemini-4-argon', effort: 'high'});
    assert.deepEqual(splitAgyModelId(' gemini-4-neon-XHigh '), {model: 'gemini-4-neon', effort: 'xhigh'});
    assert.deepEqual(splitAgyModelId('gemini-pro-orchestrator-neon'), {model: 'gemini-pro-orchestrator-neon'});
    assert.deepEqual(splitAgyModelId('high'), {model: 'high'});
});

test('resolveAgyChoice: a listed model keeps an effort it takes and drops one it does not', () => {
    assert.deepEqual(resolveAgyChoice('gemini-4-argon', 'high', models), {model: 'gemini-4-argon', effort: 'high'});
    assert.deepEqual(resolveAgyChoice('gemini-4-neon', 'XHIGH', models), {model: 'gemini-4-neon', effort: 'xhigh'});
    assert.deepEqual(resolveAgyChoice('gemini-pro-orchestrator', 'high', models), {
        model: 'gemini-pro-orchestrator',
        effort: ''
    });
});

test('resolveAgyChoice: a model that must be given a level runs at medium, or its only one, when none it takes is chosen', () => {
    assert.deepEqual(resolveAgyChoice('gemini-4-argon', '', models), {model: 'gemini-4-argon', effort: 'medium'});
    assert.deepEqual(resolveAgyChoice('gemini-4-argon', 'max', models), {model: 'gemini-4-argon', effort: 'medium'});
    assert.deepEqual(resolveAgyChoice('gpt-oss-120b', '', models), {model: 'gpt-oss-120b', effort: 'medium'});
});

test('resolveAgyChoice: an id stored with its level is split, a level chosen beside it winning', () => {
    assert.deepEqual(resolveAgyChoice('gemini-4-argon-low', '', models), {model: 'gemini-4-argon', effort: 'low'});
    assert.deepEqual(resolveAgyChoice('gemini-4-argon-low', 'high', models), {model: 'gemini-4-argon', effort: 'high'});
    assert.deepEqual(resolveAgyChoice('gemini-4-argon-low', 'xhigh', models), {model: 'gemini-4-argon', effort: 'low'});
    assert.deepEqual(resolveAgyChoice('gpt-oss-120b-medium', '', models), {model: 'gpt-oss-120b', effort: 'medium'});
});

test('resolveAgyChoice: agy\'s default model keeps an effort only some model takes', () => {
    assert.deepEqual(resolveAgyChoice('', 'xhigh', models), {model: '', effort: 'xhigh'});
    assert.deepEqual(resolveAgyChoice('', 'max', models), {model: '', effort: ''});
    assert.deepEqual(resolveAgyChoice('  ', '', models), {model: '', effort: ''});
});

test('resolveAgyChoice: with no models to go by, the choice goes as it is, but for what agy never takes', () => {
    assert.deepEqual(resolveAgyChoice('gemini-9', 'high', []), {model: 'gemini-9', effort: 'high'});
    assert.deepEqual(resolveAgyChoice('', 'high', []), {model: '', effort: 'high'});
    assert.deepEqual(resolveAgyChoice('', 'max', []), {model: '', effort: ''});
    assert.deepEqual(resolveAgyChoice('gemini-9-high', 'low', []), {model: 'gemini-9-high', effort: ''});
    assert.deepEqual(resolveAgyChoice('some-coordinator', 'high', []), {model: 'some-coordinator', effort: ''});
});

test('the models entry reaches no Node module, so a renderer can import it', () => {
    for (const file of ['models.js', 'types.js', 'agyModels.js']) {
        const source = readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8');
        const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
        assert.ok(imports.every((i) => i.startsWith('./')), `${file} imports ${imports.join(', ')}`);
    }
});
