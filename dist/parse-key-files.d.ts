import type { GitProviderAdapter, GitTreeEntry, RepoDigest, RepoDigestFileHit } from "@majico-xyz/git-providers";
export declare function classifyRepoPath(path: string): RepoDigestFileHit["kind"] | null;
export declare function selectKeyFilesFromTree(tree: GitTreeEntry[]): string[];
export declare function buildRepoDigest(input: {
    adapter: GitProviderAdapter;
    owner: string;
    repo: string;
    ref: string;
}): Promise<RepoDigest>;
