// Fixtures: what agy prints, and a stand-in agy that prints it.
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const isWindows = process.platform === 'win32';

/** A fresh folder of the test's own. */
export const tempDir = (name = 'agent-harness-') => mkdtempSync(join(tmpdir(), name));

/** `agy models` as agy 1.5.16 prints it, its "Fetching…" line included. */
export const AGY_MODELS = [
    'Fetching available models...',
    'gemini-4-neon-high\tGemini 4 Neon (High)',
    'gemini-4-neon-xhigh\tGemini 4 Neon (XHigh)',
    'gemini-4-neon-medium\tGemini 4 Neon (Medium)',
    'gemini-4-neon-low\tGemini 4 Neon (Low)',
    'gemini-4-argon-medium\tGemini 4 Argon (Medium)',
    'gemini-4-argon-high\tGemini 4 Argon (High)',
    'gemini-4-argon-low\tGemini 4 Argon (Low)',
    'gemini-pro-orchestrator-neon\tOrchestrator (Neon)',
    'gemini-pro-orchestrator\tOrchestrator (Carbon)',
    'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
    'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
    'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
    'claude-opus-5-5-low\tClaude Opus 5.5 (Low)',
    'claude-opus-5-5-medium\tClaude Opus 5.5 (Medium)',
    'claude-opus-5-5-high\tClaude Opus 5.5 (High)',
    'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
].join('\n');

/** When the used-up group's quota comes back in the `/usage` fixture. */
export const USED_UP_UNTIL = '2099-01-01T00:00:00Z';

/**
 * `agy -p /usage --output-format json` as agy 1.5.16 answers it, but with the
 * Claude and GPT group's week used up. Its unused 5-hour window resets at the
 * epoch, as agy says of a window nothing has been taken from.
 */
export const AGY_USAGE = JSON.stringify({
    conversation_id: '',
    status: 'SUCCESS',
    command: {
        name: 'usage',
        data: {
            groups: [
                {
                    name: 'Gemini Models',
                    description: 'Models within this group: Gemini 4 Neon, Gemini 4 Argon, Orchestrator (Neon), Orchestrator (Carbon), Gemini 3.8 Flash',
                    buckets: [
                        {id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.8188685178756714, reset_time: '2026-11-30T22:34:51Z'},
                        {id: 'gemini-5h', window: '5h', remaining_fraction: 0.9899333119392395, reset_time: '2026-11-24T23:56:38Z'},
                    ],
                },
                {
                    name: 'Claude and GPT models',
                    description: 'Models within this group: Claude Opus 5.5, Claude Sonnet 5.5, GPT-OSS 120B',
                    buckets: [
                        {id: '3p-weekly', window: 'weekly', remaining_fraction: 0.001, reset_time: USED_UP_UNTIL},
                        {id: '3p-5h', window: '5h', remaining_fraction: 1, reset_time: '1970-01-01T00:00:00Z'},
                    ],
                },
            ],
        },
    },
});

/**
 * A stand-in for agy in `dir`: answers `--version`, `models` and `-p /usage`
 * from the fixtures, and anything else by failing. On Windows it is a launcher
 * script, as npm would install it, so it is started through cmd.
 */
export function fakeAgy(dir, {models = AGY_MODELS, usage = AGY_USAGE, version = '9.9.9'} = {}) {
    writeFileSync(join(dir, 'models.txt'), models + '\n');
    writeFileSync(join(dir, 'usage.json'), usage + '\n');
    writeFileSync(join(dir, 'version.txt'), version + '\n');
    if (isWindows) {
        const exe = join(dir, 'agy.cmd');
        writeFileSync(exe, [
            '@echo off',
            'if "%~1"=="--version" (type "%~dp0version.txt" & exit /b 0)',
            'if "%~1"=="models" (type "%~dp0models.txt" & exit /b 0)',
            'if "%~1"=="-p" (type "%~dp0usage.json" & exit /b 0)',
            'echo Error: unknown command %1 1>&2',
            'exit /b 2',
            '',
        ].join('\r\n'));
        return exe;
    }
    const exe = join(dir, 'agy');
    writeFileSync(exe, [
        '#!/bin/sh',
        'here=$(dirname "$0")',
        'case "$1" in',
        '  --version) cat "$here/version.txt" ;;',
        '  models) cat "$here/models.txt" ;;',
        '  -p) cat "$here/usage.json" ;;',
        '  *) echo "Error: unknown command $1" >&2; exit 2 ;;',
        'esac',
        '',
    ].join('\n'));
    chmodSync(exe, 0o755);
    return exe;
}
