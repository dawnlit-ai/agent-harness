// What Claude's answers about itself read as, and its usage limit.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import { CLAUDE_NOT_INSTALLED, claudeStatus, planUsage, sdkExecutable, signedInAs } from '../dist/claude.js';
import { holdUsage, usageHeldUntil, usageLimit, waitForUsage } from '../dist/claudeLimit.js';
import { isWindows, tempDir } from './support.ts';

/** A usage answer with these limits; planUsage reads nothing else of it. */
const usageWith = (rate_limits: unknown): SDKControlGetUsageResponse => ({rate_limits}) as SDKControlGetUsageResponse;

test('signedInAs: an account, an API key, another provider, or nothing to sign with', () => {
    assert.equal(signedInAs({email: 'a@b.c', subscriptionType: 'max'}), 'Signed in as a@b.c · max');
    assert.equal(signedInAs({email: 'a@b.c'}), 'Signed in as a@b.c');
    assert.equal(signedInAs({apiKeySource: 'ANTHROPIC_API_KEY'}), 'Using an API key from ANTHROPIC_API_KEY');
    assert.equal(signedInAs({apiProvider: 'bedrock'}), 'Through bedrock');
    assert.equal(signedInAs({apiKeySource: 'none', apiProvider: 'firstParty'}), null);
});

test('planUsage: the limits that carry a figure, per-model weeks after the rest', () => {
    const usage = usageWith({
        five_hour: {utilization: 12, resets_at: '2026-11-24T20:00:00Z'},
        seven_day: {utilization: 40, resets_at: null},
        seven_day_opus: {utilization: null, resets_at: null},
        seven_day_sonnet: null,
        model_scoped: [{display_name: 'Fable', utilization: 3, resets_at: '2026-11-30T00:00:00Z'}],
    });
    assert.deepEqual(planUsage(usage), [
        {label: 'All models · 5 hours', percentUsed: 12, resetsAt: '2026-11-24T20:00:00Z'},
        {label: 'All models · week', percentUsed: 40, resetsAt: null},
        {label: 'Fable · week', percentUsed: 3, resetsAt: '2026-11-30T00:00:00Z'},
    ]);
    assert.deepEqual(planUsage(usageWith(null)), []);
    assert.deepEqual(planUsage(null), []);
});

test('claudeStatus: with no binary, says how to install it', async () => {
    assert.deepEqual(await claudeStatus(null), {
        id: 'claude',
        name: 'Claude Code',
        executable: '',
        version: null,
        ready: false,
        detail: CLAUDE_NOT_INSTALLED,
        usage: [],
    });
});

test('claudeStatus: a binary that is not there is reported, not thrown', async () => {
    const missing = join(tempDir(), isWindows ? 'claude.exe' : 'claude');
    const status = await claudeStatus(missing);
    assert.equal(status.ready, false);
    assert.equal(status.version, null);
    assert.match(status.detail, /Not found at|did not start/);
});

test('sdkExecutable: npm\'s launcher script is followed to what it starts', {skip: !isWindows && 'launcher scripts are Windows\''}, () => {
    const dir = tempDir();
    const shim = join(dir, 'claude.cmd');
    // As cmd-shim writes it for a package whose bin is a JavaScript file.
    writeFileSync(shim, [
        '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '',
        'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '',
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
        '',
    ].join('\r\n'));
    assert.equal(sdkExecutable(shim), resolve(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'));

    // And for one whose bin is a program.
    writeFileSync(shim, '@ECHO off\r\n"%~dp0\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
    assert.equal(sdkExecutable(shim), resolve(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));

    const other = join(dir, 'other.cmd');
    writeFileSync(other, '@echo off\r\nclaude %*\r\n');
    assert.throws(() => sdkExecutable(other), /launcher script/);

    mkdirSync(join(dir, 'bin'));
    assert.equal(sdkExecutable(join(dir, 'bin', 'claude.exe')), join(dir, 'bin', 'claude.exe'));
});

// November in Los Angeles is UTC−8.
const at = (h: number, m: number): number => Date.UTC(2026, 10, 24, h, m);

test('usageLimit: a reset time in its zone, today or tomorrow', () => {
    const now = at(10, 0); // 02:00 in Los Angeles
    assert.deepEqual(usageLimit('You\'ve hit your session limit · resets 3:20am (America/Los_Angeles)', now), {until: at(11, 20)});
    assert.deepEqual(usageLimit('Usage limit reached. resets 1am (America/Los_Angeles)', now), {until: at(9, 0) + 86_400_000});
});

test('usageLimit: a reset just past has not taken yet, rather than being a day away', () => {
    const now = at(11, 25); // 03:25 in Los Angeles
    assert.deepEqual(usageLimit('You\'ve hit your weekly limit · resets 3:20am (America/Los_Angeles)', now), {until: now + 60_000});
});

test('usageLimit: a reset with a date', () => {
    assert.deepEqual(usageLimit('weekly limit reached · resets Dec 1, 9am (UTC)', at(10, 0)), {until: Date.UTC(2026, 11, 1, 9, 0)});
});

test('usageLimit: no reset named waits a quarter hour; another failure is none', () => {
    const now = at(10, 0);
    assert.deepEqual(usageLimit('Claude usage limit reached', now), {until: now + 15 * 60_000});
    assert.equal(usageLimit('Connection reset by peer', now), null);
});

test('holdUsage: holds every call until the latest reset, and is cancelled while waiting', async () => {
    assert.equal(usageHeldUntil(), 0);
    const until = Date.now() + 60_000;
    assert.equal(holdUsage({until}), true);
    assert.equal(holdUsage({until: until - 1}), false);
    assert.equal(usageHeldUntil(), until);
    await assert.rejects(waitForUsage(AbortSignal.timeout(20)), /aborted/);
});
