const crypto = require('node:crypto');
const { promisify } = require('node:util');

const derive = promisify(crypto.scrypt);
const prefixes = { workflow: 'WF1xQ', session: 'RP1xQ', 'character-card': 'CH1xQ', storybook: 'SB1xQ' };
const aad = Buffer.from('rpgraph-filename:v1');
const parameters = { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const maximumNameBytes = 128;

function validName(name) {
  return typeof name === 'string' && !/[/\\]/.test(name) &&
    !Array.from(name).some(character => character.charCodeAt(0) < 32);
}

function privateFileType(value) {
  if (typeof value !== 'string') return undefined;
  return Object.keys(prefixes).find(type => value.startsWith(prefixes[type]) ||
    value.startsWith(prefixes[type].replace('1xQ', '2xQ')));
}

// The salt travels with the file, so copies remain readable with the same
// password in another account. Only short names are decrypted, never file data.
function createFilenameCipher(password, salt) {
  const keys = new Map();
  let queue = Promise.resolve();
  let disposed = false;
  function keyFor(fileSalt) {
    if (disposed) throw new Error('The account filename session has ended.');
    const id = fileSalt.toString('hex');
    if (!keys.has(id)) {
      if (keys.size >= 64 && !fileSalt.equals(salt)) throw new Error('Too many different filename salts in this session.');
      // Serialize memory-intensive derivations. The account salt normally means
      // a complete directory needs only one derivation per signed-in session.
      const pending = queue.then(async () => {
        if (disposed) throw new Error('The account filename session has ended.');
        const key = await derive(password, Buffer.concat([aad, fileSalt]), 32, parameters);
        if (disposed) { key.fill(0); throw new Error('The account filename session has ended.'); }
        return key;
      });
      keys.set(id, pending);
      queue = pending.then(() => {}, () => {});
    }
    return keys.get(id);
  }
  return {
    async encodeCompact(name, type) {
      const prefix = prefixes[type]?.replace('1xQ', '2xQ');
      if (!prefix) throw new Error('Choose a supported file type for filename protection.');
      if (!validName(name)) throw new Error('Choose a valid filename.');
      const plaintext = Buffer.from(name, 'utf8');
      try {
        if (!plaintext.length || plaintext.length > maximumNameBytes) {
          throw new Error('Protected filenames support up to 128 UTF-8 bytes. Choose a shorter name.');
        }
        const key = await keyFor(salt);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(Buffer.concat([aad, Buffer.from(prefix)]));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return {
          fileName: `${prefix}${Buffer.concat([cipher.getAuthTag(), ciphertext]).toString('base64url')}.json`,
          metadata: { format: 'rpgraph-filename-v2', salt: salt.toString('base64'), iv: iv.toString('base64') },
        };
      } finally { plaintext.fill(0); }
    },
    async encode(name, type) {
      const prefix = prefixes[type];
      if (!prefix) throw new Error('Choose a supported file type for filename protection.');
      if (!validName(name)) throw new Error('Choose a valid filename.');
      const plaintext = Buffer.from(name, 'utf8');
      try {
        if (!plaintext.length || plaintext.length > maximumNameBytes) {
          throw new Error('Protected filenames support up to 128 UTF-8 bytes. Choose a shorter name.');
        }
        const key = await keyFor(salt);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(Buffer.concat([aad, Buffer.from(prefix)]));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return `${prefix}${Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]).toString('base64url')}.json`;
      } finally { plaintext.fill(0); }
    },
    async decode(fileName, metadata) {
      const type = privateFileType(fileName);
      if (!type || !fileName.endsWith('.json') || fileName.length > 240) return undefined;
      const prefix = fileName.slice(0, 5);
      const compact = prefix.endsWith('2xQ');
      const encoded = fileName.slice(prefix.length, -5);
      const bytes = Buffer.from(encoded, 'base64url');
      if (bytes.toString('base64url') !== encoded ||
          bytes.length < (compact ? 17 : 45) || bytes.length > (compact ? 144 : 172)) return undefined;
      let fileSalt = bytes.subarray(0, 16);
      let iv = bytes.subarray(16, 28);
      let tag = bytes.subarray(28, 44);
      let ciphertext = bytes.subarray(44);
      if (compact) {
        if (metadata?.format !== 'rpgraph-filename-v2' || typeof metadata.salt !== 'string' || typeof metadata.iv !== 'string') return undefined;
        fileSalt = Buffer.from(metadata.salt, 'base64');
        iv = Buffer.from(metadata.iv, 'base64');
        if (fileSalt.length !== 16 || iv.length !== 12 || fileSalt.toString('base64') !== metadata.salt ||
            iv.toString('base64') !== metadata.iv) return undefined;
        tag = bytes.subarray(0, 16);
        ciphertext = bytes.subarray(16);
      }
      let plaintext;
      const chunks = [];
      try {
        const key = await keyFor(fileSalt);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(Buffer.concat([aad, Buffer.from(prefix)]));
        decipher.setAuthTag(tag);
        chunks.push(decipher.update(ciphertext));
        chunks.push(decipher.final());
        plaintext = Buffer.concat(chunks);
        const name = plaintext.toString('utf8');
        const roundtrip = Buffer.from(name, 'utf8');
        try {
          if (!roundtrip.equals(plaintext) || !validName(name)) return undefined;
        } finally { roundtrip.fill(0); }
        return name;
      } catch { return undefined; }
      finally {
        plaintext?.fill(0);
        for (const chunk of chunks) chunk.fill(0);
      }
    },
    dispose() {
      disposed = true;
      for (const key of keys.values()) void key.then(value => value.fill(0), () => {});
      keys.clear();
    },
  };
}

module.exports = { createFilenameCipher, privateFileType };
