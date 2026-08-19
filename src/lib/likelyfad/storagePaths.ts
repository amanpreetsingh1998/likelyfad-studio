/**
 * Object layout inside the `project-media` bucket.
 *
 *   <ownerId>/<projectId>/<folder>/<mediaId>.<ext>
 *
 * The first segment is load-bearing: the storage RLS policy compares it to
 * auth.uid(), so a wrong prefix is not a cosmetic difference — it is the
 * difference between a readable object and a 403. Keep every path in the app
 * going through these helpers.
 *
 * Rows written before authentication used the literal owner "default"; the
 * claim migration (scripts/claim-default-data.mjs) moves them under a real uid.
 */

export const LEGACY_OWNER = "default";

export type MediaFolder = "inputs" | "generations" | "generation-inputs";

export const MEDIA_FOLDERS: MediaFolder[] = [
  "generations",
  "inputs",
  "generation-inputs",
];

/** Everything belonging to one owner. */
export function ownerPrefix(ownerId: string): string {
  return ownerId;
}

/** Everything belonging to one project. */
export function projectPrefix(ownerId: string, projectId: string): string {
  return `${ownerId}/${projectId}`;
}

/** One folder within a project — the unit `list()` operates on. */
export function folderPrefix(
  ownerId: string,
  projectId: string,
  folder: MediaFolder | string
): string {
  return `${ownerId}/${projectId}/${folder}`;
}

/** A single stored object. */
export function mediaObjectPath(
  ownerId: string,
  projectId: string,
  folder: MediaFolder | string,
  mediaId: string,
  ext: string
): string {
  return `${ownerId}/${projectId}/${folder}/${mediaId}.${ext}`;
}
