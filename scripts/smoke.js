// Asks the agents installed on this computer about themselves, as an app would:
// where each is, its version, sign-in, usage and models. Nothing runs on a model.
import { AGENT_IDS, createAgentHarness } from '../dist/index.js';

const harness = createAgentHarness();

for (const id of AGENT_IDS) {
    const started = Date.now();
    const status = await harness.status(id);
    console.log(`\n${status.name}: ${status.ready ? 'ready' : 'not ready'} (${Date.now() - started} ms)`);
    console.log(`  executable  ${status.executable || '(none)'}`);
    console.log(`  version     ${status.version ?? '(did not say)'}`);
    console.log(`  detail      ${status.detail}`);
    for (const u of status.usage) {
        console.log(`  usage       ${u.label}: ${u.percentUsed}% used${u.resetsAt ? `, resets ${u.resetsAt}` : ''}`);
    }
    if (!status.ready) continue;
    try {
        const listed = Date.now();
        const models = await harness.models(id);
        console.log(`  models      ${models.length} (${Date.now() - listed} ms)`);
        for (const m of models) {
            const efforts = m.efforts.length > 0 ? `  [${m.efforts.join(', ')}${m.effortRequired ? '; required' : ''}]` : '';
            console.log(`    ${m.id.padEnd(30)} ${m.label}${efforts}`);
        }
    } catch (e) {
        console.log(`  models      ${e instanceof Error ? e.message : e}`);
    }
}
