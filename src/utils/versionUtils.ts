import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

/**
 * Gets the extension version from package.json
 * @returns Extension version as a string
 */
export function getExtensionVersion(): string | undefined {
    try {
        // Method 1: Using VS Code API
        const extension = vscode.extensions.getExtension('block.vscode-goose');
        if (extension) {
            return extension.packageJSON.version;
        }

        // Method 2: Fallback to reading package.json directly
        const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            return packageJson.version;
        }

        // Fallback value if both methods fail
        logger.warn('Could not determine extension version, using fallback value');
        return undefined;
    } catch (error) {
        logger.error('Error retrieving extension version:', error);
        return undefined;
    }
}
