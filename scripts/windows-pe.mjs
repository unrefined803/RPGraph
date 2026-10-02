import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';

export async function verifyWindowsExecutable(filePath, machine) {
  const file = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(64);
    assert.equal((await file.read(header, 0, 64, 0)).bytesRead, 64, 'Truncated Windows executable.');
    assert.equal(header.toString('ascii', 0, 2), 'MZ', 'Missing Windows executable header.');
    const offset = header.readUInt32LE(60);
    assert.ok(offset >= 64 && offset <= 1024 * 1024, 'Invalid Windows PE header offset.');
    const pe = Buffer.alloc(24);
    assert.equal((await file.read(pe, 0, 24, offset)).bytesRead, 24, 'Truncated Windows PE header.');
    assert.ok(pe.subarray(0, 4).equals(Buffer.from([0x50, 0x45, 0, 0])), 'Missing Windows PE signature.');
    assert.equal(pe.readUInt16LE(4), machine, 'Unexpected Windows executable architecture.');
  } finally {
    await file.close();
  }
}
