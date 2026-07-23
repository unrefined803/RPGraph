import { describe, it, expect } from 'vitest';
import { areNodeVersionsCompatible, isNodeVersion, parseNodeVersion } from './nodeVersion';

describe('node version compatibility', () => {
  it('requires matching major and minor, ignoring patch', () => {
    expect(areNodeVersionsCompatible('1.2.3', '1.2.9')).toBe(true);
    expect(areNodeVersionsCompatible('1.2.3', '1.2.0')).toBe(true);
    expect(areNodeVersionsCompatible('1.2.3', '1.3.0')).toBe(false);
    expect(areNodeVersionsCompatible('1.2.3', '2.2.3')).toBe(false);
  });

  it('parses MAJOR.MINOR.PATCH and rejects malformed input', () => {
    expect(parseNodeVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseNodeVersion('1.2')).toBeUndefined();
    expect(parseNodeVersion('01.2.3')).toBeUndefined();
    expect(parseNodeVersion('1.2.x')).toBeUndefined();
    expect(parseNodeVersion(5)).toBeUndefined();
  });

  it('isNodeVersion narrows valid version strings', () => {
    expect(isNodeVersion('1.0.0')).toBe(true);
    expect(isNodeVersion('1.0')).toBe(false);
    expect(isNodeVersion(undefined)).toBe(false);
  });
});
