import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { findAllSkillerDirs } from '../../../src/core/FileSystemUtils';

describe('FileSystemUtils - Nested', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-nested-test-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('findAllSkillerDirs', () => {
    it('finds all .agents directories in hierarchy', async () => {
      // Create nested directory structure
      const projectDir = path.join(tmpDir, 'project');
      const moduleDir = path.join(projectDir, 'module');
      const submoduleDir = path.join(moduleDir, 'submodule');

      await fs.mkdir(path.join(projectDir, '.agents'), { recursive: true });
      await fs.mkdir(path.join(moduleDir, '.agents'), { recursive: true });
      await fs.mkdir(path.join(submoduleDir, '.agents'), { recursive: true });
      // Create skiller.toml files to make them valid skiller directories
      await fs.writeFile(path.join(projectDir, '.agents', 'skiller.toml'), '');
      await fs.writeFile(path.join(moduleDir, '.agents', 'skiller.toml'), '');
      await fs.writeFile(
        path.join(submoduleDir, '.agents', 'skiller.toml'),
        '',
      );

      const skillerDirs = await findAllSkillerDirs(projectDir);

      // Should find all three .agents directories, most specific first
      expect(skillerDirs).toHaveLength(3);
      expect(skillerDirs[0]).toBe(path.join(submoduleDir, '.agents'));
      expect(skillerDirs[1]).toBe(path.join(moduleDir, '.agents'));
      expect(skillerDirs[2]).toBe(path.join(projectDir, '.agents'));
    });

    it('returns empty array when no .agents directories found', async () => {
      const someDir = path.join(tmpDir, 'empty');
      await fs.mkdir(someDir, { recursive: true });

      const skillerDirs = await findAllSkillerDirs(someDir);
      expect(skillerDirs).toHaveLength(0);
    });
  });
});
