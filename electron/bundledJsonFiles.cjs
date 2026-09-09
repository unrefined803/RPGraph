const fs = require('node:fs');
const path = require('node:path');

function bundledJsonFilesByFormat(directory, format) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.json$/i.test(entry.name))
    .filter((entry) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(directory, entry.name), 'utf8'))?.format === format;
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name);
}

module.exports = { bundledJsonFilesByFormat };
