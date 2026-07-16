import type {
  GitProviderAdapter,
  GitTreeEntry,
  RepoDigest,
  RepoDigestFileHit,
} from "@majico-xyz/git-providers";

const CANDIDATE_PATHS: Array<{
  pattern: RegExp;
  kind: RepoDigestFileHit["kind"];
}> = [
  { pattern: /^docs\/design\.md$/i, kind: "design_md" },
  { pattern: /^design\.md$/i, kind: "design_md" },
  { pattern: /^docs\/BRAND\.md$/i, kind: "brand_md" },
  { pattern: /^BRAND\.md$/i, kind: "brand_md" },
  { pattern: /^README\.md$/i, kind: "readme" },
  { pattern: /^package\.json$/i, kind: "package_json" },
  { pattern: /^tailwind\.config\.(js|ts|mjs|cjs)$/i, kind: "tailwind" },
  { pattern: /^app\/globals\.css$/i, kind: "css_vars" },
  { pattern: /^public\/(brand\/)?logo\/.+\.(svg|png)$/i, kind: "logo_asset" },
];

export function classifyRepoPath(
  path: string
): RepoDigestFileHit["kind"] | null {
  for (const { pattern, kind } of CANDIDATE_PATHS) {
    if (pattern.test(path)) return kind;
  }
  return null;
}

export function selectKeyFilesFromTree(tree: GitTreeEntry[]): string[] {
  const hits: string[] = [];
  for (const entry of tree) {
    if (entry.type !== "blob") continue;
    if (classifyRepoPath(entry.path)) hits.push(entry.path);
  }
  return hits.slice(0, 20);
}

export async function buildRepoDigest(input: {
  adapter: GitProviderAdapter;
  owner: string;
  repo: string;
  ref: string;
}): Promise<RepoDigest> {
  const { adapter, owner, repo, ref } = input;
  const tree = await adapter.getTree(owner, repo, ref);
  const paths = selectKeyFilesFromTree(tree);
  const files: RepoDigestFileHit[] = [];
  const parsed: RepoDigest["parsed"] = {};

  for (const path of paths) {
    const kind = classifyRepoPath(path)!;
    const content = await adapter.getFile(owner, repo, ref, path);
    const excerpt = content?.slice(0, 4000);
    files.push({ path, kind, excerpt });
    if (!content) continue;

    if (kind === "package_json") {
      try {
        const pkg = JSON.parse(content) as {
          name?: string;
          description?: string;
        };
        if (pkg.name) parsed.productName = pkg.name;
        if (pkg.description) parsed.oneLiner = pkg.description;
      } catch {
        /* ignore invalid json */
      }
    }
    if (kind === "readme" && !parsed.oneLiner) {
      const firstLine = content
        .split("\n")
        .find((l) => l.trim() && !l.startsWith("#"));
      if (firstLine) parsed.oneLiner = firstLine.trim().slice(0, 200);
    }
    if (kind === "brand_md") {
      const storyMatch = content.match(
        /##\s*Brand story\s*\n+([\s\S]*?)(?=\n##|\n$)/i
      );
      if (storyMatch?.[1])
        parsed.brandStory = storyMatch[1].trim().slice(0, 2000);
    }
    if (kind === "design_md") {
      try {
        const { parseDesignMarkdown } = await import("@/lib/design-md-parse");
        const design = parseDesignMarkdown(content);
        parsed.paletteTokens = design.tokens;
        parsed.headingFont = design.fonts.headingFamily;
        parsed.bodyFont = design.fonts.bodyFamily;
      } catch {
        /* design.md may not match majico schema */
      }
    }
  }

  return {
    provider: adapter.provider,
    owner,
    repo,
    ref,
    files,
    parsed,
  };
}
