const { rm, rmSync } = require('node:fs');

// temp passes literal paths and the legacy retry option. Keep its callback API
// without pulling in rimraf 2 and glob 7; this is not a general rimraf replacement.
function optionsFor(options) {
  return { recursive: true, force: true, maxRetries: options?.maxBusyTries ?? 3 };
}

function rimraf(path, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = undefined;
  }
  rm(path, optionsFor(options), callback);
}

rimraf.sync = (path, options) => rmSync(path, optionsFor(options));

module.exports = rimraf;
