// The harness end to end, against a stand-in agy started as a real process.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { type AgentId, AGY_NOT_INSTALLED, createAgentHarness } from '../dist/index.js';
import { fakeAgy, isWindows, tempDir, USED_UP_UNTIL } from './support.ts';

/** An agent the harness does not know, as an app's IPC could pass it one. */
const unknown = 'jev' as AgentId;

test('status: agy\'s version, sign-in, model count and quota', async () => {
    const agy = fakeAgy(tempDir());
    const harness = createAgentHarness({executable: (id) => (id === 'agy' ? agy : undefined)});
    assert.equal(harness.lastStatus('agy'), null);

    const status = await harness.status('agy');
    assert.deepEqual(status, {
        id: 'agy',
        name: 'Antigravity CLI',
        executable: agy,
        version: '9.9.9',
        ready: true,
        detail: 'Signed in · 7 models on offer',
        usage: [
            {label: 'Gemini · 5 hours', percentUsed: 1, resetsAt: '2026-11-24T23:56:38Z'},
            {label: 'Gemini · week', percentUsed: 18, resetsAt: '2026-11-30T22:34:51Z'},
            {label: 'Claude and GPT · 5 hours', percentUsed: 0, resetsAt: null},
            {label: 'Claude and GPT · week', percentUsed: 100, resetsAt: USED_UP_UNTIL},
        ],
    });
    assert.equal(harness.lastStatus('agy'), status);
    assert.equal(harness.heldUntil('agy', 'claude-sonnet-5-5'), Date.parse(USED_UP_UNTIL));
    assert.equal(harness.heldUntil('agy', 'gemini-4-argon'), 0);
});

test('status: a check under way is joined', async () => {
    const agy = fakeAgy(tempDir());
    const harness = createAgentHarness({executable: () => agy});
    const first = harness.status('agy');
    assert.equal(harness.status('agy'), first);
    await first;
    assert.notEqual(harness.status('agy'), first);
});

test('models: listed by base model, and the status check\'s list is reused', async () => {
    const dir = tempDir();
    const agy = fakeAgy(dir);
    const harness = createAgentHarness({executable: () => agy});
    await harness.status('agy');
    // Gone from disk: a list asked for now comes from the cache.
    fakeAgy(dir, {models: 'Fetching available models...'});
    const models = await harness.models('agy');
    assert.equal(models.length, 7);
    assert.deepEqual(models.find((m) => m.id === 'gemini-4-argon')?.efforts, ['low', 'medium', 'high']);
    await assert.rejects(harness.models('agy', {refresh: true}), /agy listed no models/);
});

test('usage: asked of agy on its own', async () => {
    const agy = fakeAgy(tempDir());
    const harness = createAgentHarness({executable: () => agy});
    const usage = await harness.usage('agy');
    assert.equal(usage.length, 4);
});

test('an agy that is not signed in says what is in the way', async () => {
    const agy = fakeAgy(tempDir(), {models: ''});
    const harness = createAgentHarness({executable: () => agy});
    // The stand-in's `models` prints nothing, as a signed-out agy lists nothing.
    const status = await harness.status('agy');
    assert.equal(status.ready, false);
    assert.equal(status.version, '9.9.9');
    assert.equal(status.detail, 'agy listed no models.');
    assert.deepEqual(status.usage, []);
});

test('an agy that is not where the app says is reported, not thrown', async () => {
    const missing = join(tempDir(), isWindows ? 'agy.exe' : 'agy');
    const harness = createAgentHarness({executable: () => missing});
    const status = await harness.status('agy');
    assert.equal(status.ready, false);
    assert.equal(status.detail, `Not found at ${missing}.`);
    await assert.rejects(harness.models('agy'), {message: `Not found at ${missing}.`});
});

test('test: a path not saved is checked, and not kept as the agent\'s status', async () => {
    const agy = fakeAgy(tempDir());
    const missing = join(tempDir(), isWindows ? 'agy.exe' : 'agy');
    const harness = createAgentHarness({executable: () => missing});

    const tried = await harness.test('agy', `  ${agy}  `);
    assert.equal(tried.ready, true);
    assert.equal(tried.executable, agy);
    assert.equal(tried.version, '9.9.9');
    assert.equal(harness.lastStatus('agy'), null);

    const saved = await harness.status('agy');
    assert.equal(saved.detail, `Not found at ${missing}.`);
    await assert.rejects(harness.test(unknown, agy), /no agent "jev"/);
});

test('locate: the app\'s own path wins, trimmed', () => {
    const harness = createAgentHarness({executable: () => '  /opt/agy  '});
    assert.equal(harness.locate('agy'), '/opt/agy');
});

test('an agent the harness does not know is refused', async () => {
    const harness = createAgentHarness();
    await assert.rejects(harness.status(unknown), /no agent "jev"/);
    assert.throws(() => harness.locate(unknown), /no agent "jev"/);
    assert.match(AGY_NOT_INSTALLED, /PATH/);
});
