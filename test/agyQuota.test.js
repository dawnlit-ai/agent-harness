// Reading agy's quota, and telling which models it holds back.
import assert from 'node:assert/strict';
import test from 'node:test';

import { agyHeldUntil, agyQuotaGroup, noteQuota, quotaUsage, readQuota } from '../dist/agy.js';
import { AGY_USAGE, USED_UP_UNTIL } from './support.js';

const groups = readQuota(AGY_USAGE);

test('quotaUsage: each group\'s windows as used, the shorter first', () => {
    assert.deepEqual(quotaUsage(groups), [
        {label: 'Gemini · 5 hours', percentUsed: 1, resetsAt: '2026-11-24T23:56:38Z'},
        {label: 'Gemini · week', percentUsed: 18, resetsAt: '2026-11-30T22:34:51Z'},
        {label: 'Claude and GPT · 5 hours', percentUsed: 0, resetsAt: null},
        {label: 'Claude and GPT · week', percentUsed: 100, resetsAt: USED_UP_UNTIL},
    ]);
});

test('quotaUsage: a window agy says does not apply now is left out', () => {
    const disabled = [{name: 'Gemini Models', buckets: [{window: '5h', remaining_fraction: 0, reset_time: USED_UP_UNTIL, disabled: true}]}];
    assert.deepEqual(quotaUsage(disabled), []);
});

test('agyHeldUntil: a model waits for its own group, found by its family', () => {
    noteQuota(groups);
    const until = Date.parse(USED_UP_UNTIL);
    assert.equal(agyHeldUntil('claude-opus-5-5'), until);
    assert.equal(agyHeldUntil('gpt-oss-120b'), until);
    assert.equal(agyHeldUntil('gemini-4-argon'), 0);
    assert.equal(agyHeldUntil('gemini-pro-orchestrator'), 0);
    assert.equal(agyHeldUntil('mistral-large'), 0);
});

test('agyQuotaGroup: what the quota a model draws on is called', () => {
    noteQuota(groups);
    assert.equal(agyQuotaGroup('claude-opus-5-5'), 'Claude and GPT');
    assert.equal(agyQuotaGroup('gemini-3.8-flash'), 'Gemini');
    assert.equal(agyQuotaGroup('mistral-large'), null);
});

test('agyHeldUntil: a group with quota again is let go', () => {
    noteQuota(groups);
    noteQuota(readQuota(AGY_USAGE.replace('"remaining_fraction":0.001', '"remaining_fraction":0.5')));
    assert.equal(agyHeldUntil('claude-opus-5-5'), 0);
});

test('readQuota: an answer that is not JSON says so', () => {
    assert.throws(() => readQuota('Please sign in'), /not JSON|other than JSON/);
    assert.deepEqual(readQuota('{}'), []);
});
