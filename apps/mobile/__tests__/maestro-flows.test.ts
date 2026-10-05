/**
 * @jest-environment node
 */
// Node, not the app's React Native environment, which resolves yaml's browser entry (an ES module).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// The workspace installs flat (pnpm-workspace.yaml: nodeLinker hoisted), so this is the yaml
// Expo's metro-config already brings: the same parser the native gate's flows were checked with.
import { parseAllDocuments } from 'yaml';

// The Maestro flows (e2e/maestro) only run on a device, so a flow that no longer parses would
// otherwise go unnoticed until a native gate run. Every flow must parse, and every launch of
// Pocket QA with cleared state must skip the intro before it looks for Sign in.

const DIR = join(__dirname, '../e2e/maestro');
const APP = 'com.reshareai.pocketqa';
const flows = readdirSync(DIR).filter((f) => f.endsWith('.yaml'));

type Command = Record<string, unknown>;
function parse(file: string) {
  const docs = parseAllDocuments(readFileSync(join(DIR, file), 'utf8'));
  const errors = docs.flatMap((d) => ('errors' in d ? d.errors.map((e) => e.message) : []));
  const [config, commands] = docs.map((d) => d.toJS() as unknown);
  return { errors, appId: (config as { appId?: string } | null)?.appId, commands: (commands ?? []) as Command[] };
}

describe('Maestro flows', () => {
  it('are all here', () => {
    expect(flows.length).toBeGreaterThan(10);
  });

  it.each(flows)('%s parses as YAML', (file) => {
    expect(parse(file).errors).toEqual([]);
  });

  it.each(flows)('%s skips the intro after every cleared-state launch of the app', (file) => {
    const { appId, commands } = parse(file);
    commands.forEach((command, i) => {
      const launch = command.launchApp as { clearState?: boolean; appId?: string } | undefined;
      if (!launch || launch.clearState !== true || (launch.appId ?? appId) !== APP) return;
      expect(commands[i + 1]).toEqual({ runFlow: '_skip-intro.yaml' });
    });
  });
});
