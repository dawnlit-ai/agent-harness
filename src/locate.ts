import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import type { AgentId } from './types.js';

/**
 * Where an agent's CLI is on this computer, when the app does not name it. An
 * app opened from the Finder or the Dock has no shell PATH to find it by, so the
 * folders each installer puts it in come first, and the PATH after them.
 */

export interface LocateOptions {
    /** Absent, this process's. */
    env?: NodeJS.ProcessEnv;
    /** Absent, the user's home folder. */
    home?: string;
}

/** Where each agent's own installer puts it. */
function installed(id: AgentId, home: string, env: NodeJS.ProcessEnv): string[] {
    if (process.platform === 'win32') {
        const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
        return id === 'claude'
            ? [join(home, '.local', 'bin', 'claude.exe')]
            : [join(local, 'agy', 'bin', 'agy.exe'), join(home, '.local', 'bin', 'agy.exe')];
    }
    return [join(home, '.local', 'bin', id), `/opt/homebrew/bin/${id}`, `/usr/local/bin/${id}`];
}

/**
 * Each place on the PATH the name could be, in the order a shell tries them. On
 * Windows a folder's program comes before its launcher scripts, which is what
 * npm installs a CLI as.
 */
function onPath(name: string, env: NodeJS.ProcessEnv): string[] {
    const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
    // A copy of Windows' environment keeps its `Path` spelling, and loses the lookup that ignores case.
    const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
    return dirs.flatMap((dir) => extensions.map((ext) => join(dir, name + ext)));
}

function isFile(path: string): boolean {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

/** The agent's CLI where its installer put it, else the first on the PATH. Null when there is none. */
export function locateAgent(id: AgentId, options: LocateOptions = {}): string | null {
    const env = options.env ?? process.env;
    const home = options.home ?? homedir();
    return [...installed(id, home, env), ...onPath(id, env)].find(isFile) ?? null;
}

/**
 * What a launcher script npm wrote for a CLI starts: the program or `cli.js` it
 * names relative to its own folder, before passing its arguments on. Null when
 * the script is not one of npm's.
 */
export function launcherTarget(script: string): string | null {
    let text: string;
    try {
        text = readFileSync(script, 'utf8');
    } catch {
        return null;
    }
    // `"%dp0%\node_modules\…\cli.js" %*` in npm's shims, `"%~dp0\…" %*` in older ones.
    const named = [...text.matchAll(/"%~?dp0%?\\([^"]+)"\s+%\*/g)].at(-1)?.[1];
    return named ? resolve(dirname(script), named) : null;
}
