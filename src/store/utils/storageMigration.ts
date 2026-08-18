/**
 * Carry localStorage across the Node Banana → Likelyfad Studio rename.
 *
 * Every key this app owns is prefixed with the product name, so the rename
 * would otherwise read as "all your projects, costs and settings are gone".
 * The migration re-keys anything left under the old prefix once, on first
 * load, and records that it ran so a later downgrade-then-upgrade does not
 * clobber newer values with stale ones.
 */

const LEGACY_PREFIX = "node-banana-";
const CURRENT_PREFIX = "likelyfad-studio-";
const MIGRATION_FLAG = "likelyfad-studio-storage-migrated";

export function migrateLegacyStorageKeys(): void {
  if (typeof window === "undefined") return;

  try {
    if (localStorage.getItem(MIGRATION_FLAG)) return;

    const legacyKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LEGACY_PREFIX)) legacyKeys.push(key);
    }

    for (const legacyKey of legacyKeys) {
      const newKey = CURRENT_PREFIX + legacyKey.slice(LEGACY_PREFIX.length);
      const value = localStorage.getItem(legacyKey);
      // Never overwrite a value already written under the new name.
      if (value !== null && localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, value);
      }
      localStorage.removeItem(legacyKey);
    }

    localStorage.setItem(MIGRATION_FLAG, "1");
  } catch (error) {
    console.error("Failed to migrate legacy storage keys:", error);
  }
}
