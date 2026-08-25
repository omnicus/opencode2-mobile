const { injectBackupExclusion } = require("./with-ios-database-backup-exclusion");

test("marks the Expo SQLite directory as excluded from iOS backups before startup returns", () => {
  const source = `import Expo\n\nclass AppDelegate: ExpoAppDelegate {\n  override func application() -> Bool {\n    return super.application(\n      application\n    )\n  }\n}\n\nclass ReactNativeDelegate {\n}\n`;
  const output = injectBackupExclusion(source);

  expect(output).toContain("excludeOpenCodeDatabaseDirectoryFromBackup()");
  expect(output).toContain('appendingPathComponent("SQLite", isDirectory: true)');
  expect(output).toContain("resourceValues.isExcludedFromBackup = true");
  expect(output).toContain('fatalError("DATABASE_BACKUP_EXCLUSION_FAILED")');
  expect(output.indexOf("excludeOpenCodeDatabaseDirectoryFromBackup()")).toBeLessThan(
    output.indexOf("return super.application("),
  );
  expect(output.indexOf("private func excludeOpenCodeDatabaseDirectoryFromBackup()")).toBeLessThan(
    output.indexOf("class ReactNativeDelegate"),
  );
  expect(injectBackupExclusion(output)).toBe(output);
});

test("fails generation when the expected Swift launch method is absent", () => {
  expect(() => injectBackupExclusion("class AppDelegate {}")).toThrow(
    "APP_DELEGATE_LAUNCH_METHOD_NOT_FOUND",
  );
});
