export type TemplateGit = (root: string, args: string[], input?: string) => string;

export function templateCommit(
  git: TemplateGit,
  root: string,
  isTemplateSource: (path: string) => boolean,
): string | null;
