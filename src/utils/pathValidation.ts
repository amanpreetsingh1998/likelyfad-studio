import * as path from "path";

/**
 * Validates a workflow directory path.
 *
 * This is the SECOND layer, not the boundary. The routes that call it are
 * gated by requireLocal() in src/lib/local/guard.ts, which switches local
 * filesystem access off unless it was explicitly opted into — that is what
 * stops these paths being reachable from a hosted deployment at all.
 *
 * It cannot be a root-confinement check, because arbitrary path access is the
 * feature: the user picks the directory from a native file dialog and expects
 * the app to save there. So this blocks the places a workflow directory is
 * never legitimately chosen, and nothing more.
 */

/**
 * Directories a workflow is never saved into.
 *
 * Chosen per platform. The list used to be nine POSIX prefixes on every
 * platform, which meant it matched nothing at all on Windows —
 * "C:\Windows\System32" and "C:\Users\<user>\.ssh" both passed it, measured.
 */
function dangerousPrefixes(): string[] {
  if (process.platform === "win32") {
    return [
      process.env.SystemRoot || "C:\Windows",
      process.env.ProgramFiles || "C:\Program Files",
      process.env["ProgramFiles(x86)"] || "C:\Program Files (x86)",
      process.env.ProgramData || "C:\ProgramData",
    ];
  }
  return [
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/sys",
    "/proc",
    "/var/run",
    "/System",
    "/Library",
    "/root",
  ];
}

export function validateWorkflowPath(inputPath: string): {
  valid: boolean;
  resolved: string;
  error?: string;
} {
  // Must be an absolute path
  if (!path.isAbsolute(inputPath)) {
    return {
      valid: false,
      resolved: inputPath,
      error: "Path must be absolute",
    };
  }

  // A workflow directory is chosen from a native file dialog, so it never
  // legitimately contains a ".." segment. Refused explicitly rather than by the
  // `path.resolve(p) !== p` string comparison this used to rely on: that
  // comparison rejected perfectly ordinary absolute paths for incidental
  // reasons (a POSIX path on Windows fails it, having been rebased onto the
  // current drive) while reporting them as traversal.
  const segments = inputPath.split(/[\/]+/);
  if (segments.includes("..")) {
    return {
      valid: false,
      resolved: path.resolve(inputPath),
      error: "Path contains traversal sequences",
    };
  }

  const resolved = path.resolve(inputPath);

  // NTFS is case-insensitive, so a case-shifted prefix must not slip past.
  const needle = process.platform === "win32" ? resolved.toLowerCase() : resolved;

  for (const prefix of dangerousPrefixes()) {
    const candidate = process.platform === "win32" ? prefix.toLowerCase() : prefix;
    if (needle === candidate || needle.startsWith(candidate + path.sep)) {
      return {
        valid: false,
        resolved,
        error: `Access to ${prefix} is not allowed`,
      };
    }
  }

  return {
    valid: true,
    resolved,
  };
}
