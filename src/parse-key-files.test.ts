import { describe, expect, it, vi } from "vitest";
import {
  buildRepoDigest,
  classifyRepoPath,
  selectKeyFilesFromTree,
} from "./parse-key-files.js";
import type { GitProviderAdapter } from "@majico-xyz/git-providers";

describe("parse-key-files", () => {
  it("classifies known brand file paths", () => {
    expect(classifyRepoPath("docs/design.md")).toBe("design_md");
    expect(classifyRepoPath("README.md")).toBe("readme");
    expect(classifyRepoPath("public/brand/logo/mark.svg")).toBe("logo_asset");
  });

  it("selects key files from tree", () => {
    const paths = selectKeyFilesFromTree([
      { path: "docs/design.md", type: "blob", sha: "a" },
      { path: "src/index.ts", type: "blob", sha: "b" },
      { path: "package.json", type: "blob", sha: "c" },
    ]);
    expect(paths).toContain("docs/design.md");
    expect(paths).toContain("package.json");
    expect(paths).not.toContain("src/index.ts");
  });

  it("buildRepoDigest parses package, readme, brand, and design hits", async () => {
    const designMd = `# Design System: Acme

**Project ID:** proj-1

## 1. Visual Theme & Atmosphere

Clean.

## 2. Color Palette & Roles

- **Majico Orange (\`#FF7800\`)**: Primary accent.
- **White (\`#F7F7F7\`)**: Surfaces.
- **Warm cream (\`#FFF8F2\`)**: Cards.
- **Near black (\`#1C1C1C\`)**: Text.
- **Warm border (\`#FAB578\`)**: Strokes.
- **Peach border (\`#FFD0A7\`)**: Integration bar.

## 3. Typography Rules

Headlines use **Poppins** for titles.
Body copy uses **Geist** for paragraphs.

## 4. Component Stylings

* **Buttons:** Accent-led.

## 5. Layout Principles

Generous spacing.
`;

    const files: Record<string, string> = {
      "package.json": JSON.stringify({
        name: "acme-app",
        description: "Ship faster",
      }),
      "README.md": "# Acme\n\nBuild delightful products.",
      "docs/BRAND.md": "## Brand story\n\nWe help teams move quickly.\n",
      "docs/design.md": designMd,
    };

    const adapter: GitProviderAdapter = {
      provider: "github",
      listOrgs: vi.fn(),
      listRepos: vi.fn(),
      getTree: vi.fn(async () =>
        Object.keys(files).map((path) => ({
          path,
          type: "blob" as const,
          sha: path,
        }))
      ),
      getFile: vi.fn(async (_owner, _repo, _ref, path) => files[path] ?? null),
    };

    const digest = await buildRepoDigest({
      adapter,
      owner: "acme",
      repo: "app",
      ref: "main",
    });

    expect(digest.provider).toBe("github");
    expect(digest.files.map((f) => f.path)).toEqual(
      expect.arrayContaining([
        "package.json",
        "README.md",
        "docs/BRAND.md",
        "docs/design.md",
      ])
    );
    expect(digest.parsed?.productName).toBe("acme-app");
    expect(digest.parsed?.oneLiner).toBe("Ship faster");
    expect(digest.parsed?.brandStory).toContain("move quickly");
    expect(digest.parsed?.headingFont).toBe("Poppins");
    expect(digest.parsed?.bodyFont).toBe("Geist");
  });

  it("buildRepoDigest ignores invalid package.json and design.md", async () => {
    const files: Record<string, string> = {
      "package.json": "{not-json",
      "design.md": "# Broken design doc",
    };

    const adapter: GitProviderAdapter = {
      provider: "gitlab",
      listOrgs: vi.fn(),
      listRepos: vi.fn(),
      getTree: vi.fn(async () =>
        Object.keys(files).map((path) => ({
          path,
          type: "blob" as const,
          sha: path,
        }))
      ),
      getFile: vi.fn(async (_owner, _repo, _ref, path) => files[path] ?? null),
    };

    const digest = await buildRepoDigest({
      adapter,
      owner: "org",
      repo: "repo",
      ref: "main",
    });

    expect(digest.parsed?.productName).toBeUndefined();
    expect(digest.parsed?.paletteTokens).toBeUndefined();
  });

  it("buildRepoDigest falls back to readme line for oneLiner", async () => {
    const files: Record<string, string> = {
      "README.md": "# Title\n\nFallback tagline from readme.",
    };

    const adapter: GitProviderAdapter = {
      provider: "github",
      listOrgs: vi.fn(),
      listRepos: vi.fn(),
      getTree: vi.fn(async () => [
        { path: "README.md", type: "blob" as const, sha: "r" },
        { path: "docs", type: "tree" as const, sha: "t" },
      ]),
      getFile: vi.fn(async (_owner, _repo, _ref, path) => files[path] ?? null),
    };

    const digest = await buildRepoDigest({
      adapter,
      owner: "acme",
      repo: "app",
      ref: "main",
    });

    expect(digest.parsed?.oneLiner).toBe("Fallback tagline from readme.");
  });

  it("buildRepoDigest uses readme when package.json lacks description", async () => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "pkg-only" }),
      "README.md": "# Title\n\nReadme tagline here.",
    };

    const adapter: GitProviderAdapter = {
      provider: "github",
      listOrgs: vi.fn(),
      listRepos: vi.fn(),
      getTree: vi.fn(async () =>
        Object.keys(files).map((path) => ({
          path,
          type: "blob" as const,
          sha: path,
        }))
      ),
      getFile: vi.fn(async (_owner, _repo, _ref, path) => files[path] ?? null),
    };

    const digest = await buildRepoDigest({
      adapter,
      owner: "acme",
      repo: "app",
      ref: "main",
    });

    expect(digest.parsed?.productName).toBe("pkg-only");
    expect(digest.parsed?.oneLiner).toBe("Readme tagline here.");
  });

  it("buildRepoDigest skips readme oneLiner when only headings exist", async () => {
    const files: Record<string, string> = {
      "README.md": "# Title\n## Subtitle\n",
    };

    const adapter: GitProviderAdapter = {
      provider: "github",
      listOrgs: vi.fn(),
      listRepos: vi.fn(),
      getTree: vi.fn(async () => [
        { path: "README.md", type: "blob" as const, sha: "r" },
      ]),
      getFile: vi.fn(async (_owner, _repo, _ref, path) => files[path] ?? null),
    };

    const digest = await buildRepoDigest({
      adapter,
      owner: "acme",
      repo: "app",
      ref: "main",
    });

    expect(digest.parsed?.oneLiner).toBeUndefined();
  });

  it("buildRepoDigest skips parsing when file content is missing", async () => {
    const adapter: GitProviderAdapter = {
      provider: "github",
      listOrgs: vi.fn(),
      listRepos: vi.fn(),
      getTree: vi.fn(async () => [
        { path: "package.json", type: "blob" as const, sha: "p" },
      ]),
      getFile: vi.fn(async () => null),
    };

    const digest = await buildRepoDigest({
      adapter,
      owner: "acme",
      repo: "app",
      ref: "main",
    });

    expect(digest.files[0]?.excerpt).toBeUndefined();
    expect(digest.parsed?.productName).toBeUndefined();
  });

  it("buildRepoDigest keeps package oneLiner over readme and ignores brand md without story", async () => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({
        name: "pkg",
        description: "From package",
      }),
      "README.md": "Should not override package description",
      "docs/BRAND.md": "## Other section\n\nNo brand story header match.",
    };

    const adapter: GitProviderAdapter = {
      provider: "github",
      listOrgs: vi.fn(),
      listRepos: vi.fn(),
      getTree: vi.fn(async () =>
        Object.keys(files).map((path) => ({
          path,
          type: "blob" as const,
          sha: path,
        }))
      ),
      getFile: vi.fn(async (_owner, _repo, _ref, path) => files[path] ?? null),
    };

    const digest = await buildRepoDigest({
      adapter,
      owner: "acme",
      repo: "app",
      ref: "main",
    });

    expect(digest.parsed?.oneLiner).toBe("From package");
    expect(digest.parsed?.brandStory).toBeUndefined();
  });
});
