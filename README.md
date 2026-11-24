# @dawnlit/agent-harness

The agent CLIs installed on this computer — Claude Code (`claude`) and the
Antigravity CLI (`agy`) — found, and asked for their version, sign-in, models
and usage. Shared by Patchbay and Robot Log Analyzer.

Running an agent stays with each app for now; what the harness offers for that
is the plumbing both need: starting a CLI on Windows as well, the environment
to start it in, and Claude's usage-limit hold.

## Use

```ts
import { createAgentHarness } from '@dawnlit/agent-harness';

const harness = createAgentHarness({
    // The path the app's settings name, if any. Otherwise it is looked for.
    executable: (id) => (id === 'claude' ? settings.claudePath : settings.agyPath) || undefined,
});

harness.locate('agy');                      // 'C:\Users\…\AppData\Local\agy\bin\agy.exe', or null
await harness.models('claude');             // [{ id: 'opus', label: 'Opus 5.5', efforts: ['low', …] }, …]
await harness.models('agy', {refresh: true});
await harness.status('agy');                // { version, ready, detail, usage: [{ label, percentUsed, resetsAt }] }
await harness.usage('agy', {signal});       // the usage alone, which also updates heldUntil
harness.heldUntil('agy', 'claude-opus-5-5'); // when that model's quota is back, or 0
```

- `models` reuses a list for ten minutes; `refresh` asks again. It rejects,
  saying why, when the agent is not installed or not signed in.
- `status` never rejects: what went wrong is its `detail`. A check already
  under way is joined, and `lastStatus` gives the last one found.
- Model ids are the agent's own. agy lists each leveled model once per level
  (`gemini-4-argon-high`); the harness gives it once (`gemini-4-argon`) with
  its levels as `efforts` and `effortRequired: true`. `resolveAgyChoice` turns
  a stored `(model, effort)` pair — an old `<id>-<level>` one too — into what
  `agy --model` and `--effort` take.

### In a renderer

`@dawnlit/agent-harness/models` holds the types and agy's model-id helpers, and
reaches no Node module.

### Where an agent is looked for

The folders its installer puts it in first — an app opened from the Finder has
no shell PATH to find it by — then the PATH.

| | Windows | macOS, Linux |
|---|---|---|
| `claude` | `~\.local\bin\claude.exe` | `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin` |
| `agy` | `%LOCALAPPDATA%\agy\bin\agy.exe`, `~\.local\bin\agy.exe` | the same three |

On the PATH, Windows' launcher scripts (`claude.cmd`, as npm installs it) are
found too, after a folder's program. `spawnAgent` and `runCommand` start one
through cmd; the Agent SDK is handed the program or `cli.js` the script names.

### Claude

Claude's models, sign-in and plan usage are asked of the CLI through the
Claude Agent SDK, in a session that runs no turn. The SDK is a peer dependency:
the app installs it, and without it Claude's status says it could not start.

## Develop

```sh
npm install
npm test        # build, then node --test
npm run smoke   # ask the agents installed here; nothing runs on a model
```

The package is ESM, built by `tsc` into `dist`. An app links it with
`"@dawnlit/agent-harness": "file:../agent-harness"`.

## License

Apache-2.0. See [LICENSE](LICENSE).
