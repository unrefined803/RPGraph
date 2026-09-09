import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';
import {
  createNpcLibraryService,
  npcLibraryRoots,
  scanNpcLibrary,
} from './npcLibrary.cjs';

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpgraph-npc-library-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

function characterCard(id: string, bio = '') {
  return {
    format: 'rpgraph-character',
    version: '2.0.0',
    character: {
      id, name: `Character ${id}`, description: '', personality: '', speechStyle: '', role: '',
      playable: true,
      images: [{ id: 'portrait', name: 'Portrait', mimeType: 'image/jpeg', size: 3,
        dataUrl: 'data:image/jpeg;base64,YWJj', description: 'Portrait' }],
      apps: { fotogram: { accountId: `${id}-fg`, enabled: true, username: `${id}.photo`,
        displayName: `Character ${id}`, bio, avatarImageId: 'portrait',
        initialPosts: [{ id: 'hello', text: 'Hello', imageId: 'portrait' }] } },
    },
  };
}

async function writeJson(directory: string, fileName: string, value: unknown) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, fileName), JSON.stringify(value), 'utf8');
}

describe('NPC library paths', () => {
  it('resolves explicit development, packaged and user-data roots', () => {
    assert.deepEqual(npcLibraryRoots({ isPackaged: false, resourcesPath: '/runtime',
      projectRootPath: '/project', userDataPath: '/profile' }), {
      bundled: path.join('/project', 'resources', 'npc-characters'),
      user: path.join('/profile', 'npc-characters'),
    });
    assert.equal(npcLibraryRoots({ isPackaged: true, resourcesPath: '/runtime',
      projectRootPath: '/project', userDataPath: '/profile' }).bundled,
    path.join('/runtime', 'npc-characters'));
  });
});

describe('NPC library scanning', () => {
  it('loads arbitrary JSON basenames and isolates malformed containers', async () => {
    const root = await temporaryDirectory();
    const bundled = path.join(root, 'bundled');
    const user = path.join(root, 'user');
    await writeJson(bundled, 'any-readable-name.JSON', characterCard('bundled'));
    await writeJson(user, 'another.json', characterCard('user'));
    await fs.writeFile(path.join(user, 'broken.json'), '{', 'utf8');
    await writeJson(user, 'dangling.json', {
      ...characterCard('dangling'),
      character: { ...characterCard('dangling').character,
        apps: { fotogram: { ...characterCard('dangling').character.apps.fotogram, avatarImageId: 'missing' } } },
    });

    const result = await scanNpcLibrary({ bundled, user });
    assert.deepEqual(result.entries.map((entry: { character: { id: string } }) => entry.character.id), ['bundled', 'user']);
    assert.deepEqual(result.diagnostics.map((entry: { code: string }) => entry.code), ['invalid-json', 'invalid-container']);
  });

  it('silently skips encrypted, unrelated and symlinked files and reports unsupported cards', async () => {
    const root = await temporaryDirectory();
    const bundled = path.join(root, 'bundled');
    const user = path.join(root, 'user');
    await writeJson(user, 'encrypted.json', { format: 'rpgraph-encrypted-character', ciphertext: 'opaque' });
    await writeJson(user, 'workflow.json', { format: 'rpgraph-workflow' });
    await writeJson(user, 'future.json', { ...characterCard('future'), version: '99.0.0' });
    await writeJson(root, 'outside.json', characterCard('outside'));
    await fs.symlink(path.join(root, 'outside.json'), path.join(user, 'linked.json'));

    const result = await scanNpcLibrary({ bundled, user });
    assert.equal(result.entries.length, 0);
    assert.equal(result.skipped, 2);
    assert.deepEqual(result.diagnostics.map((entry: { code: string }) => entry.code), ['unsupported-version']);
  });

  it('retains source tiers and duplicate IDs for registry-level conflict handling', async () => {
    const root = await temporaryDirectory();
    const bundled = path.join(root, 'bundled');
    const user = path.join(root, 'user');
    await writeJson(bundled, 'fallback.json', characterCard('same', 'bundled'));
    await writeJson(user, 'first.json', characterCard('same', 'first'));
    await writeJson(user, 'second.json', characterCard('same', 'second'));
    const scanned = await scanNpcLibrary({ bundled, user });
    assert.deepEqual(scanned.entries.map((entry) => [entry.tier, entry.character.id]), [
      ['bundled', 'same'], ['user', 'same'], ['user', 'same'],
    ]);

    await fs.rename(path.join(user, 'second.json'), path.join(user, 'second.txt'));
    const resolved = await scanNpcLibrary({ bundled, user });
    assert.deepEqual(resolved.entries.map((entry) => entry.tier), ['bundled', 'user']);
    assert.equal(resolved.entries[1].character.apps?.fotogram?.bio, 'first');
  });

  it('caches results and makes explicit reload repeatable', async () => {
    const root = await temporaryDirectory();
    const roots = { bundled: path.join(root, 'bundled'), user: path.join(root, 'user') };
    await writeJson(roots.user, 'npc.json', characterCard('npc'));
    const opened: string[] = [];
    const service = createNpcLibraryService({ roots, openPath: async (directory: string) => {
      opened.push(directory);
      return '';
    } });
    assert.equal(service.current().entries.length, 0);
    const [first, concurrent] = await Promise.all([service.reload(), service.reload()]);
    assert.equal(first, concurrent);
    assert.equal(service.current(), first);
    assert.deepEqual(await service.reload(), first);
    assert.deepEqual(await service.openUserDirectory(), { path: roots.user });
    assert.deepEqual(opened, [roots.user]);
  });
});
