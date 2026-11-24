// Finding an agent's CLI: its installer's folders first, then the PATH.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import test from 'node:test';

import { locateAgent } from '../dist/locate.js';
import { isWindows, tempDir } from './support.js';

const touch = (...parts) => {
    const path = join(...parts);
    mkdirSync(join(path, '..'), {recursive: true});
    writeFileSync(path, '');
    return path;
};

/** A system-wide install outside the test's folders, which would be found first on a developer's Mac. */
const systemWide = (id) => !isWindows && [`/opt/homebrew/bin/${id}`, `/usr/local/bin/${id}`].some(existsSync);

test('locateAgent: where the installer puts it comes before the PATH', () => {
    const home = tempDir();
    const bin = tempDir();
    const installed = touch(home, '.local', 'bin', isWindows ? 'claude.exe' : 'claude');
    touch(bin, isWindows ? 'claude.exe' : 'claude');
    assert.equal(locateAgent('claude', {home, env: {PATH: bin}}), installed);
});

test('locateAgent: agy\'s own installer folder on Windows', {skip: !isWindows && 'Windows only'}, () => {
    const home = tempDir();
    const local = tempDir();
    const installed = touch(local, 'agy', 'bin', 'agy.exe');
    touch(home, '.local', 'bin', 'agy.exe');
    assert.equal(locateAgent('agy', {home, env: {LOCALAPPDATA: local, PATH: ''}}), installed);
});

test('locateAgent: the first folder on the PATH that has it', {skip: systemWide('agy') && 'agy is installed system-wide here'}, () => {
    const home = tempDir();
    const first = tempDir();
    const second = tempDir();
    touch(second, isWindows ? 'agy.exe' : 'agy');
    const found = touch(first, isWindows ? 'agy.cmd' : 'agy');
    assert.equal(locateAgent('agy', {home, env: {PATH: [first, second].join(delimiter)}}), found);
});

test('locateAgent: a folder\'s program before its launcher script, and Windows\' Path spelling', {skip: !isWindows && 'Windows only'}, () => {
    const home = tempDir();
    const bin = tempDir();
    touch(bin, 'claude.cmd');
    const program = touch(bin, 'claude.exe');
    assert.equal(locateAgent('claude', {home, env: {Path: bin}}), program);
});

test('locateAgent: null when it is nowhere, and a folder by its name is not it', {skip: systemWide('claude') && 'claude is installed system-wide here'}, () => {
    const home = tempDir();
    const bin = tempDir();
    mkdirSync(join(bin, isWindows ? 'claude.exe' : 'claude'));
    assert.equal(locateAgent('claude', {home, env: {PATH: bin}}), null);
    assert.equal(locateAgent('claude', {home, env: {}}), null);
});
