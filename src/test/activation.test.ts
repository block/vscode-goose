import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Packaged Extension Activation Test Suite', () => {
	test('Extension should activate successfully', async () => {
		console.log('Running activation test...');

		// Find the extension by its ID (name in package.json)
		const extensionId = 'block.vscode-goose'; // Make sure this matches package.json publisher.name
		const extension = vscode.extensions.getExtension(extensionId);

		// 1. Check if the extension is present
		if (!extension) {
			// Log available extensions if not found
			const availableExtensions = vscode.extensions.all.map((ext: vscode.Extension<any>) => ext.id).join(', ');
			console.error(`Available extensions: ${availableExtensions}`);
			assert.fail(`Extension with ID '${extensionId}' not found.`);
		}
		console.log(`Extension '${extensionId}' found.`);

		// 2. Check if it's already active (it might activate on startup)
		if (extension.isActive) {
			console.log(`Extension '${extensionId}' is already active.`);
			assert.ok(true, 'Extension was already active.');
			return; // Test passes if already active
		}

		// 3. Attempt to activate the extension (handles cases where it might already be active)
		console.log(`Ensuring extension '${extensionId}' is active...`);
		try {
			// VS Code's activate() should be idempotent or handle multiple calls gracefully.
			// We call it to ensure activation completes if VS Code didn't auto-activate it fully yet.
			await extension.activate();
			console.log(`Extension '${extensionId}' activation call completed.`);
		} catch (err: any) {
			// Check if the error is the specific "already registered" error.
			// This indicates VS Code likely auto-activated it successfully before our explicit call.
			const alreadyRegisteredError = "already registered";
			if (err.message && err.message.includes(alreadyRegisteredError)) {
				console.warn(`Caught expected error during explicit activation (likely already active): ${err.message}`);
				// Treat this specific error as acceptable, as it means activation already happened.
			} else {
				// Any other error during activation is unexpected.
				console.error(`Unexpected error activating extension '${extensionId}':`, err);
				assert.fail(`Failed to activate extension '${extensionId}': ${err}`);
			}
		}

		// 4. Final check: Assert that the extension is now definitively active
		assert.ok(extension.isActive, 'Extension should be active after activation attempt.');
		console.log(`Extension '${extensionId}' confirmed active.`);

		// 5. Verify core bundled dependency (yaml) is accessible
		console.log(`Verifying bundled 'yaml' dependency...`);
		try {
			// Attempt to require and use the yaml module directly
			// This should work if esbuild bundled it correctly
			const YAML = require('yaml');
			const testYaml = 'key: value';
			const parsed = YAML.parse(testYaml);
			assert.strictEqual(parsed.key, 'value', 'YAML parsing failed');
			console.log(`Successfully required and used 'yaml' module.`);
		} catch (err) {
			console.error(`Failed to require or use bundled 'yaml' module:`, err);
			assert.fail(`Bundled 'yaml' module is not functional: ${err}`);
		}
	});
});
