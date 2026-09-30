const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const derive = promisify(scrypt);
const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function accountName(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(value) ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value)) {
    throw new Error('Use 1–40 letters, numbers, underscores or hyphens for the username.');
  }
  return value.toLowerCase();
}

function validatePassword(password) {
  if (typeof password !== 'string' || !password || password.length > 1024) {
    throw new Error('Enter a password of 1–1024 characters.');
  }
}

function createLocalAccounts(userData) {
  const accountsRoot = path.join(userData, 'accounts');
  let selected;
  let pending = false;
  async function directory(username) {
    const name = accountName(username);
    const root = path.join(accountsRoot, name);
    const parent = await fs.lstat(accountsRoot);
    const info = await fs.lstat(root);
    if (!parent.isDirectory() || parent.isSymbolicLink() || !info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Invalid account directory.');
    }
    return root;
  }
  async function exclusive(action, sameWorkspace = false) {
    if (pending || (selected !== undefined && !sameWorkspace)) throw new Error('Restart RPGraph to choose another account.');
    pending = true;
    try { return await action(); } finally { pending = false; }
  }
  return {
    async list() {
      let entries;
      try { entries = await fs.readdir(accountsRoot, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const accounts = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const root = await directory(entry.name);
          const record = JSON.parse(await fs.readFile(path.join(root, 'account.json'), 'utf8'));
          if (record.version === 1 && record.username === entry.name) accounts.push({ username: record.username });
        } catch { /* Incomplete or unsupported accounts are not offered for login. */ }
      }
      return accounts.sort((a, b) => a.username.localeCompare(b.username));
    },
    async create(username, password) {
      return exclusive(async () => {
        const name = accountName(username);
        validatePassword(password);
        const salt = randomBytes(32);
        const verifier = await derive(password, salt, 32, parameters);
        await fs.mkdir(accountsRoot, { recursive: true, mode: 0o700 });
        if ((await fs.lstat(accountsRoot)).isSymbolicLink()) throw new Error('Invalid accounts directory.');
        const root = path.join(accountsRoot, name);
        try { await fs.mkdir(root, { mode: 0o700 }); }
        catch (error) { if (error.code === 'EEXIST') throw new Error('This username already exists.', { cause: error }); throw error; }
        try {
          for (const folder of ['files', 'characters', 'npc-characters']) {
            await fs.mkdir(path.join(root, folder), { mode: 0o700 });
          }
          await fs.writeFile(path.join(root, 'account.json'), JSON.stringify({
            version: 1, username: name, salt: salt.toString('hex'), verifier: verifier.toString('hex'),
          }), { flag: 'wx', mode: 0o600 });
        } catch (error) {
          await fs.rm(root, { recursive: true, force: true }).catch(() => {});
          throw error;
        }
        selected = { username: name, root, password };
        return { username: name };
      });
    },
    async unlock(username, password) {
      return exclusive(async () => {
        validatePassword(password);
        const root = await directory(username);
        const record = JSON.parse(await fs.readFile(path.join(root, 'account.json'), 'utf8'));
        if (record.version !== 1 || record.username !== accountName(username) ||
            !/^[a-f0-9]{64}$/.test(record.salt) || !/^[a-f0-9]{64}$/.test(record.verifier)) {
          throw new Error('Invalid account record.');
        }
        const verifier = await derive(password, Buffer.from(record.salt, 'hex'), 32, parameters);
        if (!timingSafeEqual(verifier, Buffer.from(record.verifier, 'hex'))) throw new Error('Incorrect username or password.');
        selected = { username: record.username, root, password };
        return { username: record.username };
      }, selected?.username === accountName(username));
    },
    async useLocal() { return exclusive(async () => { selected = null; }, selected === null); },
    prepare() {
      if (pending) throw new Error('Wait for the current account operation to finish.');
      selected = undefined;
    },
    async delete(password) {
      return exclusive(async () => {
        if (!selected) throw new Error('Sign in before deleting an account.');
        validatePassword(password);
        const username = selected.username;
        const root = await directory(username);
        if (root !== selected.root) throw new Error('Invalid account directory.');
        const record = JSON.parse(await fs.readFile(path.join(root, 'account.json'), 'utf8'));
        if (record.version !== 1 || record.username !== username ||
            !/^[a-f0-9]{64}$/.test(record.salt) || !/^[a-f0-9]{64}$/.test(record.verifier)) {
          throw new Error('Invalid account record.');
        }
        const verifier = await derive(password, Buffer.from(record.salt, 'hex'), 32, parameters);
        if (!timingSafeEqual(verifier, Buffer.from(record.verifier, 'hex'))) {
          throw new Error('Incorrect account password.');
        }
        await fs.rm(root, { recursive: true });
        selected = undefined;
        return { username };
      }, true);
    },
    get root() {
      if (selected === undefined) throw new Error('Choose a local workspace or sign in first.');
      return selected?.root ?? userData;
    },
    get active() { return !!selected; },
    get password() { return selected?.password ?? ''; },
  };
}

module.exports = { createLocalAccounts };
