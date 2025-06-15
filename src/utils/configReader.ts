import * as fsDefault from 'fs';
import * as osDefault from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { logger as singletonLogger } from './logger';

const logger = singletonLogger.createSource('ConfigReader');

export interface GooseConfig {
    provider: string | null;
    model: string | null;
}

/**
 * File system interface for testing and dependency injection
 */
export interface FileSystem {
    existsSync(path: string): boolean;
    readFileSync(path: string, options?: { encoding?: string, flag?: string } | string): string | Buffer;
}

/**
 * OS interface for testing and dependency injection
 */
export interface OS {
    homedir(): string;
    platform(): string;
}

/**
 * Get the path to the Goose config file based on the current operating system
 * @param os The OS module to use (for testing)
 * @returns The path to the config file, or null if the platform isn't supported or APPDATA is missing on Windows.
 */
export function getConfigPath(os: OS = osDefault): string | null {
    const homeDir = os.homedir();
    let configPath: string;

    switch (os.platform()) {
        case 'win32':
            // Windows path: %APPDATA%\Block\goose\config\config.yaml
            // Fallback to the typical Roaming path if APPDATA is undefined
            const appData = process.env.APPDATA ||
                path.join(homeDir, 'AppData', 'Roaming');
            configPath = path.join(appData, 'Block', 'goose', 'config', 'config.yaml');
            break;
        case 'darwin': // macOS
        case 'linux':
        default: // Assume Unix-like structure for other platforms
            configPath = path.join(homeDir, '.config', 'goose', 'config.yaml');
            break;
    }
    return configPath;
}

/**
 * Read and parse the Goose configuration file
 * @param fs Optional file system implementation for testing
 * @param os Optional OS implementation for testing
 * @returns A GooseConfig object containing provider and model, or null values if not found or on error.
 */
export function readGooseConfig(fs: FileSystem = fsDefault, os: OS = osDefault): GooseConfig {
    const defaultConfig: GooseConfig = { provider: null, model: null };
    const configPath = getConfigPath(os);

    if (!configPath) {
        logger.warn('Could not determine Goose config path for this platform.');
        return defaultConfig;
    }

    logger.info(`Attempting to read Goose config from: ${configPath}`);

    try {
        if (!fs.existsSync(configPath)) {
            logger.info('Goose config file not found at expected location.');
            return defaultConfig;
        }

        const fileContents = fs.readFileSync(configPath, 'utf8');

        // Handle both string and buffer return types
        const contentStr = typeof fileContents === 'string'
            ? fileContents
            : fileContents.toString('utf8');

        const config = YAML.parse(contentStr) as any; // Use 'any' for flexibility, validate below

        if (typeof config !== 'object' || config === null) {
            logger.warn('Failed to parse Goose config file: Invalid YAML structure.');
            return defaultConfig;
        }

        const provider = config.GOOSE_PROVIDER && typeof config.GOOSE_PROVIDER === 'string' ? config.GOOSE_PROVIDER : null;
        const model = config.GOOSE_MODEL && typeof config.GOOSE_MODEL === 'string' ? config.GOOSE_MODEL : null;

        if (!provider) {
            logger.warn('GOOSE_PROVIDER key not found or invalid in config file.');
            // Don't return early, still check for model
        }
        if (!model) {
             logger.warn('GOOSE_MODEL key not found or invalid in config file.');
        }

        logger.info(`Loaded config: Provider=${provider ?? 'MISSING'}, Model=${model ?? 'MISSING'}`);
        // Return nulls if keys are missing, ServerManager will handle this as an error
        return { provider, model };

    } catch (error: any) {
        logger.error(`Error reading or parsing Goose config file at ${configPath}:`, error.message);
        // Do not show VS Code error here, let ServerManager decide based on context
        return defaultConfig; // Return nulls on error (file read/parse error)
    }
}

/**
 * Gets the determined path to the configuration file.
 * This is essentially a wrapper around getConfigPath for clarity.
 * @param os Optional OS implementation for testing
 * @returns The config file path string, or null if not found/determined.
 */
export function getConfigFilePath(os: OS = osDefault): string | null {
    return getConfigPath(os);
}
