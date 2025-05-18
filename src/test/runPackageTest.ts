// @ts-check // Use JSDoc type checking

const path = require('path');
const fs = require('fs');
const os = require('os');
const { runTests } = require('@vscode/test-electron');
const { execSync } = require('child_process'); // To run npm commands

async function main() {
    let userDataDir; // Declare here to be accessible in catch block
    try {
        console.log('Starting package integration test...');

        // 1. Get package info (Use paths relative to project root where the script is invoked from)
        const packageJsonPath = './package.json';
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        // const packageName = packageJson.name; // Not used for VSIX name construction here
        const packageVersion = packageJson.version;
        // Construct the VSIX name to match the output of the 'package:dist' script
        const vsixName = `vscode-goose-${packageVersion}.vsix`;
        const vsixDistDir = './dist'; // Relative to project root
        const vsixPath = path.join(vsixDistDir, vsixName); // Expected path after packaging

        console.log(`Expecting VSIX: ${vsixPath}`);

        // 2. Run the package:dist command
        console.log('Packaging extension...');
        // Run from the project root directory (cwd defaults to process.cwd() which is project root)
        execSync('npm run package:dist', { stdio: 'inherit' });
        console.log('Packaging complete.');

        // 3. Check if VSIX exists
        if (!fs.existsSync(vsixPath)) {
            throw new Error(`Failed to find packaged VSIX at ${vsixPath}`);
        }
        console.log(`Found VSIX: ${vsixPath}`);

        // 4. Set up VS Code test environment options
        const projectRoot = path.resolve(__dirname, '../../../'); // Go up 3 levels from out/test/test
        const extensionDevelopmentPath = projectRoot;
        // Point to the *compiled* suite runner using an absolute path from project root
        const extensionTestsPath = path.join(projectRoot, 'out/test/test/suite/index.js'); // Absolute path
        const testWorkspace = path.join(projectRoot, 'test-workspace'); // Absolute path
        // Create a temporary directory for user data to ensure clean state
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-test-user-data-'));

        // Ensure test workspace exists
        if (!fs.existsSync(testWorkspace)) {
            fs.mkdirSync(testWorkspace);
        }
        console.log(`Using temporary user data dir: ${userDataDir}`);


        // 5. Run the tests with the VSIX installed
        console.log('Launching VS Code with packaged extension installed...');
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            // Set environment variable to signal suite runner to only run package tests
            extensionTestsEnv: { 'VSCODE_PKG_TEST': '1' },
            // workspacePath: testWorkspace, // Optional
            launchArgs: [
                `--install-extension=${vsixPath}`,
                `--user-data-dir=${userDataDir}`, // Use clean user data dir
                // '--disable-extensions' // Optionally disable other extensions
                testWorkspace // Open specific workspace if needed
            ],
        });
        console.log('Tests finished.');
        // Clean up temporary user data dir
        console.log(`Cleaning up temporary user data dir: ${userDataDir}`);
        fs.rmSync(userDataDir, { recursive: true, force: true });


    } catch (err) {
        console.error('Failed to run package integration tests:', err);
        // Clean up temporary dir even on error
        if (typeof userDataDir !== 'undefined' && fs.existsSync(userDataDir)) {
            console.log(`Cleaning up temporary user data dir after error: ${userDataDir}`);
            fs.rmSync(userDataDir, { recursive: true, force: true });
        }
        process.exit(1);
    }
}

main();
