const { withAppDelegate } = require("expo/config-plugins");

const startupCall = "excludeOpenCodeDatabaseDirectoryFromBackup()";
const helper = `
  private func excludeOpenCodeDatabaseDirectoryFromBackup() {
    do {
      let fileManager = FileManager.default
      let documentsDirectory = try fileManager.url(
        for: .documentDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      var databaseDirectory = documentsDirectory.appendingPathComponent("SQLite", isDirectory: true)
      try fileManager.createDirectory(
        at: databaseDirectory,
        withIntermediateDirectories: true
      )
      var resourceValues = URLResourceValues()
      resourceValues.isExcludedFromBackup = true
      try databaseDirectory.setResourceValues(resourceValues)
    } catch {
      fatalError("DATABASE_BACKUP_EXCLUSION_FAILED")
    }
  }
`;

function injectBackupExclusion(contents) {
  if (contents.includes(startupCall)) return contents;
  const returnMarker = "    return super.application(";
  const returnIndex = contents.indexOf(returnMarker);
  if (returnIndex === -1) throw new Error("APP_DELEGATE_LAUNCH_METHOD_NOT_FOUND");
  const classMatch = /class AppDelegate[^{]*\{/.exec(contents);
  if (!classMatch) throw new Error("APP_DELEGATE_CLASS_NOT_FOUND");
  const openingIndex = classMatch.index + classMatch[0].lastIndexOf("{");
  const closingIndex = matchingBraceIndex(contents, openingIndex);
  if (closingIndex === -1) throw new Error("APP_DELEGATE_CLASS_END_NOT_FOUND");

  const withHelper = `${contents.slice(0, closingIndex)}${helper}${contents.slice(closingIndex)}`;
  return `${withHelper.slice(0, returnIndex)}    ${startupCall}\n${withHelper.slice(returnIndex)}`;
}

function matchingBraceIndex(contents, openingIndex) {
  let depth = 0;
  for (let index = openingIndex; index < contents.length; index += 1) {
    if (contents[index] === "{") depth += 1;
    if (contents[index] === "}") depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function withIosDatabaseBackupExclusion(config) {
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") {
      throw new Error("SWIFT_APP_DELEGATE_REQUIRED");
    }
    mod.modResults.contents = injectBackupExclusion(mod.modResults.contents);
    return mod;
  });
}

module.exports = withIosDatabaseBackupExclusion;
module.exports.injectBackupExclusion = injectBackupExclusion;
