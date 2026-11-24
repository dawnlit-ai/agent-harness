import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { withToolPath } from './toolPath.js';

/**
 * Starting an agent's CLI, on Windows too, where npm installs a CLI as a
 * launcher script (`claude.cmd`) that Node starts only through cmd.
 */

/**
 * What a parent Claude Code session sets, which would tell a CLI started from
 * this app that it runs inside that session — an app started with `npm run dev`
 * from a terminal agent has them — and Electron's switch to run as plain Node,
 * which an agent's own children must not inherit.
 */
const INHERITED = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ELECTRON_RUN_AS_NODE'];

/** The environment an agent's CLI is started with: `base` without those, and with the tool folders on its PATH. */
export function agentEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env = {...base};
    for (const name of INHERITED) delete env[name];
    return withToolPath(env);
}

/** A Windows launcher script, as npm installs a CLI: `claude.cmd`. */
export const isLauncherScript = (exe: string): boolean => process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe);

/**
 * An argument as cmd hands it on whole. cmd expands `%NAME%` even inside quotes,
 * and a line break ends its command, so an argument holding either is refused
 * rather than passed on changed.
 */
function quoteForCmd(arg: string): string {
    if (/[%\r\n]/.test(arg)) {
        throw new Error(`A launcher script cannot be given an argument holding % or a line break: ${JSON.stringify(arg)}`);
    }
    if (arg === '') return '""';
    return /[\s"&|<>^(),;=!]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

export interface SpawnAgentOptions {
    cwd?: string;
    /** Absent, `agentEnv()`. */
    env?: NodeJS.ProcessEnv;
}

/**
 * Starts an agent's CLI with its console hidden, through cmd when it is a
 * launcher script. Throws, as `spawn` does, when it cannot be started at all;
 * a binary that is not there is reported as the child's `error`.
 */
export function spawnAgent(exe: string, args: readonly string[], options: SpawnAgentOptions = {}): ChildProcessWithoutNullStreams {
    const env = options.env ?? agentEnv();
    if (isLauncherScript(exe)) {
        // One command line, as Node would join the arguments itself and warn that it does.
        const line = [exe, ...args].map(quoteForCmd).join(' ');
        return spawn(line, {cwd: options.cwd, env, shell: true, windowsHide: true});
    }
    return spawn(exe, [...args], {cwd: options.cwd, env, windowsHide: true});
}

/**
 * Ends the process and everything it started. On Windows a launcher's cmd, or
 * the shells and scripts an agent ran, would outlive it otherwise.
 */
export function killTree(child: ChildProcess): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {windowsHide: true});
    } else {
        child.kill('SIGTERM');
    }
}

export interface CommandOptions extends SpawnAgentOptions {
    /** Written to its stdin, which is then closed. */
    input?: string;
    /** Aborting ends the process and its children, and rejects with an `AbortError`. */
    signal?: AbortSignal;

    /** Each line it writes to stdout. */
    onLine?(line: string): void;
}

export interface Exited {
    code: number | null;
    stderr: string;
}

function abortError(signal: AbortSignal): Error {
    const error = new Error('The operation was aborted', {cause: signal.reason});
    error.name = 'AbortError';
    return error;
}

/**
 * Runs an agent's CLI to its end. Resolves however it exits; rejects when it
 * could not be started — `ENOENT` when it is not there — or `signal` aborted it.
 */
export function runCommand(exe: string, args: readonly string[], options: CommandOptions = {}): Promise<Exited> {
    const {signal} = options;
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError(signal));
            return;
        }
        let child: ChildProcessWithoutNullStreams;
        try {
            child = spawnAgent(exe, args, options);
        } catch (e) {
            reject(e);
            return;
        }
        let settled = false;
        const settle = (finish: () => void): void => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', abort);
            finish();
        };
        const abort = (): void => {
            killTree(child);
            settle(() => reject(abortError(signal!)));
        };
        signal?.addEventListener('abort', abort, {once: true});

        let stderr = '';
        createInterface({input: child.stdout}).on('line', (line) => options.onLine?.(line));
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
        child.on('error', (e) => settle(() => reject(e)));
        child.on('close', (code) => settle(() => resolve({code, stderr})));
        // A child that exits before reading its input closes the pipe under the write.
        child.stdin.on('error', () => undefined);
        // On stdin rather than in the arguments, which Windows caps near 32,000 characters.
        child.stdin.end(options.input ?? '');
    });
}
