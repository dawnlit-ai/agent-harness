// Starting an agent's CLI: its output, its input, its exit, and Windows' launcher scripts.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { agentEnv, runCommand } from '../dist/command.js';
import { isWindows, tempDir } from './support.ts';

const node = process.execPath;

test('runCommand: each stdout line, from the input it was given', async () => {
    const lines: string[] = [];
    const exited = await runCommand(node, ['-e', 'process.stdin.pipe(process.stdout)'], {
        input: 'one\ntwo\nthree',
        onLine: (line) => lines.push(line),
    });
    assert.deepEqual(exited, {code: 0, stderr: ''});
    assert.deepEqual(lines, ['one', 'two', 'three']);
});

test('runCommand: a failing exit resolves with its code and what it said', async () => {
    const exited = await runCommand(node, ['-e', 'console.error("Error: not signed in"); process.exit(3)']);
    assert.equal(exited.code, 3);
    assert.match(exited.stderr, /not signed in/);
});

test('runCommand: a binary that is not there rejects with ENOENT', async () => {
    const missing = join(tempDir(), isWindows ? 'agy.exe' : 'agy');
    await assert.rejects(runCommand(missing, ['--version']), {code: 'ENOENT'});
});

test('runCommand: aborting ends it and rejects with an AbortError', async () => {
    const started = Date.now();
    await assert.rejects(
        runCommand(node, ['-e', 'setTimeout(() => {}, 60_000)'], {signal: AbortSignal.timeout(300)}),
        {name: 'AbortError'},
    );
    assert.ok(Date.now() - started < 10_000);
    await assert.rejects(runCommand(node, ['--version'], {signal: AbortSignal.abort()}), {name: 'AbortError'});
});

test('agentEnv: a parent Claude Code session\'s variables are left behind', () => {
    const env = agentEnv({
        PATH: '/bin',
        CLAUDECODE: '1',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        ELECTRON_RUN_AS_NODE: '1',
        KEEP: 'yes'
    });
    assert.equal(env.CLAUDECODE, undefined);
    assert.equal(env.CLAUDE_CODE_ENTRYPOINT, undefined);
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(env.KEEP, 'yes');
});

test('runCommand: a launcher script gets each argument whole', {skip: !isWindows && 'launcher scripts are Windows\''}, async () => {
    // A folder with a space and a parenthesis, as "Program Files (x86)" has.
    const dir = join(tempDir(), 'npm (global)');
    mkdirSync(dir);
    writeFileSync(join(dir, 'args.js'), 'console.log(JSON.stringify(process.argv.slice(2)))');
    const script = join(dir, 'agent.cmd');
    writeFileSync(script, `@"${node}" "%~dp0args.js" %*\r\n`);

    const args = ['plain', 'with space', 'a&b|c', '<in>', 'caret^', '', 'quo"te', '-p', '/usage'];
    const lines: string[] = [];
    const exited = await runCommand(script, args, {onLine: (line) => lines.push(line)});
    assert.equal(exited.code, 0, exited.stderr);
    assert.deepEqual(JSON.parse(lines.at(-1) ?? 'null'), args);
});

test('runCommand: a launcher script is not handed what cmd would change', {skip: !isWindows && 'launcher scripts are Windows\''}, async () => {
    const script = join(tempDir(), 'agent.cmd');
    writeFileSync(script, '@echo off\r\n');
    await assert.rejects(runCommand(script, ['%PATH%']), /% or a line break/);
    await assert.rejects(runCommand(script, ['two\nlines']), /% or a line break/);
});
