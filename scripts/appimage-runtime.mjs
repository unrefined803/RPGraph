import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';

async function readExactly(file, size, offset) {
  assert.ok(Number.isSafeInteger(offset) && offset >= 0, 'Invalid ELF file offset.');
  const buffer = Buffer.alloc(size);
  const { bytesRead } = await file.read(buffer, 0, size, offset);
  assert.equal(bytesRead, size, 'Truncated AppImage runtime.');
  return buffer;
}

// Inspect ELF headers without executing the runtime or requiring host binutils.
export async function verifyStaticAppImageRuntime(artifact) {
  const file = await open(artifact, 'r');
  try {
    const header = await readExactly(file, 64, 0);
    assert.ok(header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])),
      'The AppImage runtime must be an ELF executable.');
    assert.equal(header[4], 2, 'The AppImage runtime must use ELF64.');
    assert.equal(header[5], 1, 'The AppImage runtime must use little-endian encoding.');
    assert.equal(header.readUInt16LE(18), 62, 'The AppImage runtime must target x86_64.');
    assert.ok(header.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 0x02])),
      'The artifact must be a type-2 AppImage.');
    const entrySize = header.readUInt16LE(54);
    const entryCount = header.readUInt16LE(56);
    assert.equal(entrySize, 56, 'Unexpected ELF program-header size.');
    assert.ok(entryCount > 0 && entryCount <= 1024, 'Invalid ELF program-header count.');
    const entries = await readExactly(file, entrySize * entryCount, Number(header.readBigUInt64LE(32)));
    for (let index = 0; index < entryCount; index++) {
      const entry = entries.subarray(index * entrySize, (index + 1) * entrySize);
      const type = entry.readUInt32LE(0);
      assert.notEqual(type, 3, 'The AppImage runtime must not require a system ELF interpreter.');
      if (type !== 2) continue;
      // Static PIE executables can have PT_DYNAMIC, but must have no DT_NEEDED entries.
      const size = Number(entry.readBigUInt64LE(32));
      assert.ok(size > 0 && size <= 1024 * 1024 && size % 16 === 0, 'Invalid ELF dynamic table.');
      const dynamic = await readExactly(file, size, Number(entry.readBigUInt64LE(8)));
      for (let offset = 0; offset < dynamic.length; offset += 16) {
        const tag = dynamic.readBigInt64LE(offset);
        if (tag === 0n) break;
        assert.notEqual(tag, 1n, 'The AppImage runtime must not depend on host shared libraries.');
      }
    }
  } finally {
    await file.close();
  }
}
