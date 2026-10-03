const formatVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parsedFormatVersion(value) {
  const match = typeof value === 'string' ? formatVersionPattern.exec(value) : null;
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : undefined;
}

function compareFormatVersions(left, right) {
  return left.major - right.major || left.minor - right.minor;
}

/**
 * Status of a MAJOR.MINOR workflow or RP save format version. 'current' and
 * 'legacy' versions are loadable ('legacy' ones go through the renderer's
 * migration steps); 'newer' needs an RPGraph update; 'unsupported' is older
 * than the oldest version with a migration path; 'invalid' is not a version.
 */
function formatVersionStatus(value, currentVersion, oldestLoadableVersion = currentVersion) {
  const version = parsedFormatVersion(value);
  const current = parsedFormatVersion(currentVersion);
  const oldest = parsedFormatVersion(oldestLoadableVersion);
  if (!version || !current || !oldest) {
    return 'invalid';
  }
  const difference = compareFormatVersions(version, current);
  if (difference === 0) {
    return 'current';
  }
  if (difference > 0) {
    return 'newer';
  }
  return compareFormatVersions(version, oldest) >= 0 ? 'legacy' : 'unsupported';
}

module.exports = { formatVersionStatus };
