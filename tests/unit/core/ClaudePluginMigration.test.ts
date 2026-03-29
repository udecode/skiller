import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  listClaudePluginAuxiliaryRuleNames,
  planClaudePluginSkillsMigration,
} from '../../../src/core/ClaudePluginMigration';

describe('ClaudePluginMigration', () => {
  let tmpDir: string;
  let tmpHome: string;
  const originalHome = process.env.HOME;
  const allowAllSources = async () => ({ installable: true });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'skiller-plugin-migrate-'),
    );
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-plugin-home-'));
    process.env.HOME = tmpHome;
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  async function writeKnownMarketplaces(
    marketplaces: Record<
      string,
      { source: Record<string, unknown>; installLocation?: string }
    >,
  ): Promise<void> {
    const knownPath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'known_marketplaces.json',
    );
    await fs.mkdir(path.dirname(knownPath), { recursive: true });
    await fs.writeFile(knownPath, JSON.stringify(marketplaces, null, 2));
  }

  async function writeMarketplaceCatalog(
    marketplaceId: string,
    plugins: Array<{ name: string; source: unknown }>,
  ): Promise<void> {
    const marketplacePath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'marketplaces',
      marketplaceId,
      '.claude-plugin',
      'marketplace.json',
    );
    await fs.mkdir(path.dirname(marketplacePath), { recursive: true });
    await fs.writeFile(
      marketplacePath,
      JSON.stringify({ name: marketplaceId, plugins }, null, 2),
    );
  }

  it('dedupes marketplace repo installs across multiple enabled plugins', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'settings.json'),
      JSON.stringify(
        {
          enabledPlugins: {
            'debug@dotai': true,
            'test@dotai': true,
            'compound-engineering@every-marketplace': true,
            'planning-with-files@planning-with-files': true,
          },
        },
        null,
        2,
      ),
    );

    await writeKnownMarketplaces({
      dotai: {
        source: { source: 'github', repo: 'udecode/dotai' },
      },
      'every-marketplace': {
        source: {
          source: 'github',
          repo: 'EveryInc/compound-engineering-plugin',
        },
      },
      'planning-with-files': {
        source: {
          source: 'github',
          repo: 'othmanadi/planning-with-files',
        },
      },
    });

    await writeMarketplaceCatalog('dotai', [
      { name: 'debug', source: './.claude-plugin/plugins/debug' },
      { name: 'test', source: './.claude-plugin/plugins/test' },
    ]);
    await writeMarketplaceCatalog('every-marketplace', [
      {
        name: 'compound-engineering',
        source: './plugins/compound-engineering',
      },
    ]);
    await writeMarketplaceCatalog('planning-with-files', [
      { name: 'planning-with-files', source: './' },
    ]);

    const plan = await planClaudePluginSkillsMigration(tmpDir, {
      inspectSource: allowAllSources,
    });

    expect(plan.installs).toEqual([
      {
        pluginIds: ['compound-engineering@every-marketplace'],
        source: 'EveryInc/compound-engineering-plugin',
        strategy: 'marketplace-source',
      },
      {
        pluginIds: ['planning-with-files@planning-with-files'],
        source: 'othmanadi/planning-with-files',
        strategy: 'marketplace-source',
      },
      {
        pluginIds: ['debug@dotai', 'test@dotai'],
        source: 'udecode/dotai',
        strategy: 'marketplace-source',
      },
    ]);
    expect(plan.unresolved).toEqual([]);
  });

  it('prefers explicit plugin source URLs over marketplace repo fallback', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'settings.json'),
      JSON.stringify(
        {
          enabledPlugins: {
            'linear@claude-plugins-official': true,
          },
        },
        null,
        2,
      ),
    );

    await writeKnownMarketplaces({
      'claude-plugins-official': {
        source: {
          source: 'github',
          repo: 'anthropics/claude-plugins-official',
        },
      },
    });

    await writeMarketplaceCatalog('claude-plugins-official', [
      {
        name: 'linear',
        source: {
          source: 'url',
          url: 'https://github.com/acme/linear-plugin.git',
        },
      },
    ]);

    const plan = await planClaudePluginSkillsMigration(tmpDir, {
      inspectSource: allowAllSources,
    });

    expect(plan.installs).toEqual([
      {
        pluginIds: ['linear@claude-plugins-official'],
        source: 'https://github.com/acme/linear-plugin.git',
        strategy: 'plugin-source',
      },
    ]);
    expect(plan.unresolved).toEqual([]);
  });

  it('uses legacy manifest plugin ids when settings.json is absent', async () => {
    await fs.mkdir(path.join(tmpDir, '.agents'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.agents', '.skiller.json'),
      JSON.stringify(
        {
          version: 1,
          targets: {
            '.agents/skills': [
              {
                sourceType: 'plugin',
                pluginId: 'compound-engineering@every-marketplace',
                sourceKind: 'skill',
                sourceRelPath: 'skills/ce-work',
                destRelPath: 'compound-engineering-ce-work',
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    await writeKnownMarketplaces({
      'every-marketplace': {
        source: {
          source: 'github',
          repo: 'EveryInc/compound-engineering-plugin',
        },
      },
    });

    await writeMarketplaceCatalog('every-marketplace', [
      {
        name: 'compound-engineering',
        source: './plugins/compound-engineering',
      },
    ]);

    const plan = await planClaudePluginSkillsMigration(tmpDir, {
      inspectSource: allowAllSources,
    });

    expect(plan.installs).toEqual([
      {
        pluginIds: ['compound-engineering@every-marketplace'],
        source: 'EveryInc/compound-engineering-plugin',
        strategy: 'marketplace-source',
      },
    ]);
    expect(plan.unresolved).toEqual([]);
  });

  it('reports unresolved plugins when no repo source can be inferred', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'settings.json'),
      JSON.stringify(
        {
          enabledPlugins: {
            'mystery@unknown-marketplace': true,
          },
        },
        null,
        2,
      ),
    );

    const plan = await planClaudePluginSkillsMigration(tmpDir);

    expect(plan.installs).toEqual([]);
    expect(plan.unresolved).toEqual([
      {
        pluginId: 'mystery@unknown-marketplace',
        reason:
          'No repo or URL source could be inferred for marketplace unknown-marketplace',
      },
    ]);
  });

  it('reports unresolved plugins when the resolved repo is not a valid skills repo', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'settings.json'),
      JSON.stringify(
        {
          enabledPlugins: {
            'lsp-servers@claude-lsp-servers': true,
          },
        },
        null,
        2,
      ),
    );

    await writeKnownMarketplaces({
      'claude-lsp-servers': {
        source: {
          source: 'github',
          repo: 'yungweng/claude-lsp-servers',
        },
      },
    });

    const plan = await planClaudePluginSkillsMigration(tmpDir, {
      inspectSource: async (source) =>
        source === 'yungweng/claude-lsp-servers'
          ? {
              installable: false,
              reason:
                'Resolved source yungweng/claude-lsp-servers has no valid SKILL.md files with name and description',
            }
          : { installable: true },
    });

    expect(plan.installs).toEqual([]);
    expect(plan.unresolved).toEqual([
      {
        pluginId: 'lsp-servers@claude-lsp-servers',
        reason:
          'Resolved source yungweng/claude-lsp-servers has no valid SKILL.md files with name and description',
      },
    ]);
  });

  it('lists only auxiliary rule names that are not published skills in the migrated sources', async () => {
    const names = await listClaudePluginAuxiliaryRuleNames(
      ['EveryInc/compound-engineering-plugin', 'udecode/dotai'],
      {
        inspectSource: async (source) => {
          if (source === 'EveryInc/compound-engineering-plugin') {
            return {
              installable: true,
              publishedSkillNames: ['document-review', 'frontend-design'],
              auxiliarySkillNames: [
                'adversarial-document-reviewer',
                'frontend-design',
                'agent-native-reviewer',
              ],
            };
          }

          return {
            installable: true,
            publishedSkillNames: ['debug'],
            auxiliarySkillNames: ['debug'],
          };
        },
      },
    );

    expect(names).toEqual([
      'adversarial-document-reviewer',
      'agent-native-reviewer',
    ]);
  });
});
