const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function paths(output) {
  return output.split('\0').filter(Boolean);
}

// The HEAD commit when no changed or untracked path is one the template is built
// from, else null. A dirty tree or a repository without commits never fails the build.
export function templateCommit(git, root, isTemplateSource) {
  try {
    const head = git(root, ['rev-parse', '--verify', 'HEAD']).trim();
    if (!COMMIT_PATTERN.test(head)) return null;
    const changed = [
      ...paths(git(root, ['diff', '--name-only', '--no-renames', '-z', 'HEAD', '--'])),
      ...paths(git(root, ['ls-files', '--others', '--exclude-standard', '-z'])),
    ];
    return changed.some(isTemplateSource) ? null : head;
  } catch {
    return null;
  }
}
