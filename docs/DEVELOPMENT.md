# Goose VSCode Extension Development

This document provides information for developers working on the Goose VSCode extension.
For user documentation, see the main [README.md](../README.md).
For architectural details, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Dev Set up

1. Clone the repository
2. Navigate to the project root directory
3. Install dependencies: `npm install`
4. Install webview dependencies: `cd webview-ui && npm install && cd ..`
5. Build the extension and webview: `npm run compile`
6. Open the project root in VSCode: `code .`
7. Press F5 to start debugging (this will usually run the `compile` script automatically based on `.vscode/launch.json` preLaunchTask).

## Build Process

The extension uses a multi-step build process defined in `package.json` scripts:

1.  **`npm run build:extension`**: Uses `esbuild` to bundle the main extension code (`src/extension.ts` and its direct/indirect imports) into a single file (`out/extension.js`) with a sourcemap. This significantly reduces the package size and improves load times. The `vscode` module is marked as external as it's provided by the VS Code runtime. Dependencies listed in `devDependencies` (like `yaml`) should be correctly bundled.
2.  **`npm run compile:tests`**: Uses the TypeScript compiler (`tsc`) based on the specific `tsconfig.tests.json` configuration. This compiles *only* the test files (`src/test/**/*.ts`) into JavaScript files within the `out/test/` directory, preserving the test file structure. This ensures test files are compiled separately from the main extension bundle and placed where the test runner expects them.
3.  **`npm run build:webview`**: Navigates to the `webview-ui/` directory and runs its build process (using Vite) to create the optimized chat interface assets in `webview-ui/dist/`. (Note: `webview-ui` dependencies should be installed separately as part of the initial dev setup or by CI).
4.  **`npm run compile`**: Orchestrates the above steps, running `build:extension`, then `compile:tests`, then `build:webview`. This is the main script used for building the entire extension before testing or packaging. It ensures the main bundle is created first, followed by the separate compilation of tests, and finally the webview build.

## Testing

### Running Tests

Run tests from the project root:

- Run all tests (lint, extension unit/integration, webview, package activation): `npm run test:all`
- Run only extension unit/integration tests: `npm run test`
- Run only webview tests: `npm run test:webview`
- Run packaged activation test: `npm run test:package` (Note: This runs against the packaged `.vsix` and verifies successful activation, catching bundling issues).

### Writing Tests

When writing new tests:

1. Add test cases to the appropriate test file
2. Follow the existing pattern using `suite()` for test groups and `test()` for individual tests
3. Use `assert` functions from the Node.js assert module for validations

### Debugging Tests

To debug tests:

1. Set breakpoints in your test files
2. Use the "Extension Tests" launch configuration from `.vscode/launch.json`
3. Select "Debug Tests" from the Testing panel's menu

### WebView UI Testing

For testing the webview UI components directly:

1. Navigate to the webview directory: `cd webview-ui`
2. Run tests: `npm run test`
3. Run type-checking: `npm run type-check`
4. Return to root: `cd ..`

## Commit Message Guidelines

This project adheres to the **Conventional Commits** specification ([v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)). All commit messages **must** follow this format to enable automated changelog generation and version bumping by `release-please`.

**Format:**

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Common Types:**

*   `feat`: A new feature for the user (corresponds to `minor` in SemVer).
*   `fix`: A bug fix for the user (corresponds to `patch` in SemVer).
*   `perf`: A code change that improves performance (corresponds to `patch` in SemVer).
*   `refactor`: A code change that neither fixes a bug nor adds a feature.
*   `style`: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc).
*   `test`: Adding missing tests or correcting existing tests.
*   `build`: Changes that affect the build system or external dependencies (e.g., `npm`, `esbuild`, `vsce`).
*   `ci`: Changes to our CI configuration files and scripts (e.g., GitHub Actions).
*   `docs`: Documentation only changes.
*   `chore`: Other changes that don't modify `src` or `test` files (e.g., updating dependencies).

**Breaking Changes:** Indicate breaking changes by appending `!` after the type/scope (`feat!: ...`) or by adding `BREAKING CHANGE:` in the commit footer (corresponds to `major` in SemVer).

**Examples:**

*   `feat(webview): add support for multiple chat sessions`
*   `fix(server): prevent crash when goosed path is invalid`
*   `docs: update architecture diagram for session management`
*   `refactor(apiClient): simplify error handling logic`
*   `chore(deps): update typescript to 5.8.2`
*   `ci: add automated changelog generation step`
*   `feat(api)!: change chat endpoint structure`

## Release Process (Automated)

This project uses **`release-please`** to automate the release process based on **Conventional Commits**.

**Workflow:**

1.  **Development:** Developers push features/fixes to branches and create Pull Requests (PRs) targeting the `main` branch.
2.  **Conventional Commits:** All commits merged into `main` **must** follow the [Conventional Commits](#commit-message-guidelines) format.
3.  **Release PR Creation:** Upon merging commits to `main`, the `Release Please` GitHub Action (`.github/workflows/ci.yml`) runs automatically.
    *   It analyzes commits since the last release tag (`vscode-v*`).
    *   It determines the correct semantic version bump (major, minor, or patch).
    *   It creates or updates a special "Release PR". This PR contains:
        *   Version bumps in `package.json`, `.release-please-manifest.json`, and `webview-ui/package.json`.
        *   An updated `CHANGELOG.md` with entries generated from the conventional commit messages.
4.  **Review Release PR:** Review the automatically generated Release PR:
    *   Verify the version bump is correct.
    *   Check that the `CHANGELOG.md` entries accurately reflect the changes.
5.  **Merge Release PR:** Merge the Release PR into `main`.
6.  **Tagging and Publishing:** Merging the Release PR automatically triggers the following:
    *   `release-please` creates a Git tag (e.g., `vscode-v0.2.0`) on the merge commit.
    *   The tag push triggers the `release` job in the GitHub Actions workflow (`.github/workflows/ci.yml`).
    *   The `release` job:
        *   Checks out the code at the new tag.
        *   Installs dependencies using `npm ci`.
        *   Builds the extension (`npm run compile`).
        *   Packages the extension into a `.vsix` file (`dist/vscode-goose-vX.Y.Z.vsix`).
        *   Creates a GitHub Release associated with the tag, uploading the `.vsix` file as an asset.
        *   Publishes the `.vsix` file to the VS Code Marketplace (if `VSCE_PAT` secret is configured).

**Commit Type Impact:**

The type of Conventional Commit used when merging changes into `main` determines the version bump and whether the change appears in the `CHANGELOG.md`.

| Commit Type Prefix | SemVer Bump Triggered | Appears in CHANGELOG.md? | Example                                      |
| :----------------- | :-------------------- | :----------------------- | :------------------------------------------- |
| `feat`             | Minor (0.x.0 -> 0.y.0) | Yes (under Features)     | `feat: add dark mode toggle`                 |
| `fix`              | Patch (0.0.x -> 0.0.y) | Yes (under Bug Fixes)    | `fix: correct typo in error message`         |
| `perf`             | Patch (0.0.x -> 0.0.y) | Yes (under Performance)  | `perf: optimize rendering loop`              |
| `feat!` / `fix!`   | Major (x.y.z -> Y.0.0) | Yes (under BREAKING CHANGES) | `feat!: change API endpoint structure`       |
| `refactor`         | None                  | No                       | `refactor: simplify internal logic`          |
| `style`            | None                  | No                       | `style: format code with prettier`           |
| `test`             | None                  | No                       | `test: add unit tests for parser`            |
| `build`            | None                  | No                       | `build: update esbuild configuration`        |
| `ci`               | None                  | No                       | `ci: fix workflow trigger condition`         |
| `docs`             | None                  | No                       | `docs: update README installation steps`     |
| `chore`            | None                  | No                       | `chore: update non-essential dependencies`   |

*   **Changelog:** Only `feat`, `fix`, `perf`, and breaking changes (`!`) are included in the automatically generated `CHANGELOG.md` within the Release PR.
*   **Publishing:** A new version is published to the VS Code Marketplace *only* when a Release PR is merged, which triggers the tag creation and the `release` workflow job. Commits like `docs`, `chore`, `refactor`, etc., merged to `main` will *not* trigger a release or appear in the changelog, although they will be included in the *next* release if a `feat` or `fix` commit triggers one later.

**Manual Packaging (for testing):**

While the official release is automated, you can still build a local `.vsix` package for testing purposes using the scripts defined in `package.json`:

-   `npm run package:dist`: Builds and packages into the `dist/` folder.
-   `npm run package:skip-tests`: Skips tests, builds, and packages into the root folder.

```bash
# Example: Create a package in dist/ for local testing
npm run package:dist
```

**Note:** The `scripts/release.sh` script is **deprecated** for the main release flow but might be kept for local utility if needed (see Phase 3 tasks).

## Known Issues

Refer to the [GitHub issues page](https://github.com/block/vscode-goose/issues) for any known issues related to the VSCode extension.
