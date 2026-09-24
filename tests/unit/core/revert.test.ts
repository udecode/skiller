import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { revertAllAgentConfigs } from '../../../src/revert';

describe('Revert Core Functions', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-revert-unit-'));

    const skillerDir = path.join(tmpDir, '.agents');
    await fs.mkdir(skillerDir, { recursive: true });
    // Create skiller.toml to make it a valid skiller directory
    await fs.writeFile(path.join(skillerDir, 'skiller.toml'), '');
    await fs.writeFile(path.join(skillerDir, 'instructions.md'), 'Test Rule');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('revertAllAgentConfigs', () => {
    it('should throw error when .agents directory not found', async () => {
      const emptyDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'skiller-empty-'),
      );

      try {
        await expect(
          revertAllAgentConfigs(
            emptyDir,
            undefined,
            undefined,
            false,
            false,
            false,
            true,
          ),
        ).rejects.toThrow('.agents directory not found');
      } finally {
        await fs.rm(emptyDir, { recursive: true, force: true });
      }
    });

    it('should handle dry-run mode correctly', async () => {
      await fs.writeFile(path.join(tmpDir, '.clinerules'), 'Generated content');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await revertAllAgentConfigs(
        tmpDir,
        ['cline'],
        undefined,
        false,
        false,
        true,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[skiller:dry-run] Revert summary (dry run):'),
      );

      await expect(
        fs.access(path.join(tmpDir, '.clinerules')),
      ).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('should handle verbose logging', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await revertAllAgentConfigs(
        tmpDir,
        undefined,
        undefined,
        false,
        true,
        false,
      );

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle specific agents filter', async () => {
      await fs.writeFile(path.join(tmpDir, '.clinerules'), 'Cline content');
      await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), 'Agents content');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await revertAllAgentConfigs(
        tmpDir,
        ['cline'],
        undefined,
        false,
        false,
        false,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Reverting Cline'),
      );
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Reverting OpenAI Codex CLI'),
      );
      await expect(
        fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8'),
      ).resolves.toBe('Agents content');

      consoleSpy.mockRestore();
    });

    it('should handle keep-backups flag', async () => {
      const filePath = path.join(tmpDir, '.clinerules');
      const backupPath = `${filePath}.bak`;

      await fs.writeFile(backupPath, 'Original content');
      await fs.writeFile(filePath, 'Modified content');

      await revertAllAgentConfigs(
        tmpDir,
        ['cline'],
        undefined,
        true,
        false,
        false,
      );

      await expect(fs.access(backupPath)).resolves.toBeUndefined();

      const restoredContent = await fs.readFile(filePath, 'utf8');
      expect(restoredContent).toBe('Original content');
    });

    it('should remove backup files when keep-backups is false', async () => {
      const filePath = path.join(tmpDir, '.clinerules');
      const backupPath = `${filePath}.bak`;

      await fs.writeFile(backupPath, 'Original content');
      await fs.writeFile(filePath, 'Modified content');

      await revertAllAgentConfigs(
        tmpDir,
        ['cline'],
        undefined,
        false,
        false,
        false,
      );

      await expect(fs.access(backupPath)).rejects.toThrow();

      const restoredContent = await fs.readFile(filePath, 'utf8');
      expect(restoredContent).toBe('Original content');
    });

    it('should remove generated files without backups', async () => {
      const filePath = path.join(tmpDir, '.clinerules');
      await fs.writeFile(filePath, 'Generated content');

      await revertAllAgentConfigs(
        tmpDir,
        ['cline'],
        undefined,
        false,
        false,
        false,
      );

      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('should clean up empty directories', async () => {
      const githubDir = path.join(tmpDir, '.github');
      const cursorDir = path.join(tmpDir, '.cursor');

      await fs.mkdir(githubDir, { recursive: true });
      await fs.mkdir(cursorDir, { recursive: true });

      await revertAllAgentConfigs(
        tmpDir,
        undefined,
        undefined,
        false,
        false,
        false,
      );

      await expect(fs.access(githubDir)).rejects.toThrow();
      await expect(fs.access(cursorDir)).rejects.toThrow();
    });

    it('should preserve non-empty directories', async () => {
      const githubDir = path.join(tmpDir, '.github');
      await fs.mkdir(githubDir, { recursive: true });
      await fs.writeFile(
        path.join(githubDir, 'existing-file.txt'),
        'Existing content',
      );

      await revertAllAgentConfigs(
        tmpDir,
        undefined,
        undefined,
        false,
        false,
        false,
      );

      await expect(fs.access(githubDir)).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(githubDir, 'existing-file.txt')),
      ).resolves.toBeUndefined();
    });
  });

  describe('dry-run logging patterns', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should use [skiller:dry-run] prefix consistently when dryRun is true', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      await fs.writeFile(path.join(tmpDir, '.clinerules'), 'Generated content');

      await revertAllAgentConfigs(
        tmpDir,
        ['cline'],
        undefined,
        false,
        false,
        true,
      ); // dryRun=true

      const logCalls = consoleLogSpy.mock.calls.flat();
      const hasSkillerDryRunPrefix = logCalls.some(
        (call) =>
          typeof call === 'string' && call.includes('[skiller:dry-run]'),
      );

      expect(hasSkillerDryRunPrefix).toBe(true);
      consoleLogSpy.mockRestore();
    });

    it('should use [skiller] prefix consistently when dryRun is false', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      await fs.writeFile(path.join(tmpDir, '.clinerules'), 'Generated content');

      await revertAllAgentConfigs(
        tmpDir,
        ['cline'],
        undefined,
        false,
        false,
        false,
      ); // dryRun=false

      const logCalls = consoleLogSpy.mock.calls.flat();
      const hasSkillerPrefix = logCalls.some(
        (call) =>
          typeof call === 'string' &&
          call.includes('[skiller]') &&
          !call.includes('[skiller:dry-run]'),
      );

      expect(hasSkillerPrefix).toBe(true);
      consoleLogSpy.mockRestore();
    });
  });
});
