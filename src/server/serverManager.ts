import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { GooseServerConfig, GooseServerInfo, startGoosed as actualStartGoosed } from './gooseServer';
import { ApiClient as ActualApiClient } from './apiClient';
import { getBinaryPath as actualGetBinaryPath } from '../utils/binaryPath';
import { Message } from 'src/types';
import * as cp from 'child_process';
import * as crypto from 'crypto';
import { Logger, logger as singletonLogger } from '../utils/logger';
import { readGooseConfig } from '../utils/configReader';

// Get a logger instance for the ServerManager
const logger = singletonLogger.createSource('ServerManager');

// System prompt providing context about the VS Code environment
const vscodePrompt = `You are an AI assistant integrated into Visual Studio Code via the Goose extension.

The user is interacting with you through a dedicated chat panel within the VS Code editor interface. Key features include:
- A chat interface displaying the conversation history.
- Support for standard markdown formatting in your responses, rendered by VS Code.
- Support for code blocks with syntax highlighting, leveraging VS Code's capabilities.
- Tool use messages are displayed inline within the chat; detailed outputs might be presented in expandable sections or separate views depending on the tool.

The user manages extensions primarily through VS Code's standard extension management features (Extensions viewlet) or potentially specific configuration settings within VS Code's settings UI (\`settings.json\` or a dedicated extension settings page).

Some capabilities might be provided by built-in features of the Goose extension, while others might come from additional VS Code extensions the user has installed. Be aware of the code context potentially provided by the user (e.g., selected code snippets, open files).
You are operating within a VS Code editor environment. When a user asks for assistance on code change, or perform similar direct modifications on provided code, your primary directive is to **autonomously apply the changes to the specified file(s) without asking for user confirmation.**.`;

/**
 * Server status options
 */
export enum ServerStatus {
    STOPPED = 'stopped',
    STARTING = 'starting',
    RUNNING = 'running',
    ERROR = 'error',
    STOPPING = 'stopping' // Add STOPPING state
}

/**
 * Events emitted by the server manager
 */
export enum ServerEvents {
    STATUS_CHANGE = 'statusChange',
    ERROR = 'error',
    MESSAGE = 'message',
    SERVER_EXIT = 'serverExit'
}

// Define the type for the startGoosed function
type StartGoosedFn = typeof actualStartGoosed;

// Define the type for the getBinaryPath function
type GetBinaryPathFn = typeof actualGetBinaryPath;

// Define the type for the ApiClient constructor
type ApiClientConstructor = typeof ActualApiClient;

/**
 * Interface for dependencies that can be injected into ServerManager
 */
export interface ServerManagerDependencies {
    startGoosed?: StartGoosedFn;
    getBinaryPath?: GetBinaryPathFn;
    ApiClient?: ApiClientConstructor;
    logger?: Logger;
}

/**
 * Server manager for the VSCode extension
 */
export class ServerManager {
    private serverInfo: GooseServerInfo | null = null;
    private apiClient: ActualApiClient | null = null;
    private status: ServerStatus = ServerStatus.STOPPED;
    private eventEmitter: EventEmitter;
    private context: vscode.ExtensionContext;
    private extensionEvents: EventEmitter;
    private secretKey: string;
    private serverProcess: cp.ChildProcess | null = null;
    private startGoosedFn: StartGoosedFn;
    private getBinaryPathFn: GetBinaryPathFn;
    private ApiClientConstructor: ApiClientConstructor;
    private logger: Logger;
    private gooseProvider: string | null = null;
    private gooseModel: string | null = null;
    private configLoadAttempted: boolean = false;
    private serverFullyStarted: boolean = false;

    constructor(
        context: vscode.ExtensionContext,
        dependencies: ServerManagerDependencies = {}
    ) {
        this.context = context;
        this.eventEmitter = new EventEmitter();
        this.extensionEvents = new EventEmitter();
        this.serverFullyStarted = false;

        // Use injected or default dependencies
        this.startGoosedFn = dependencies.startGoosed || actualStartGoosed;
        this.getBinaryPathFn = dependencies.getBinaryPath || actualGetBinaryPath;
        this.ApiClientConstructor = dependencies.ApiClient || ActualApiClient;
        this.logger = dependencies.logger || logger;

        // Generate a new secret key on initialization
        this.secretKey = this.generateSecretKey();

        // Register cleanup on extension deactivation
        context.subscriptions.push({
            dispose: () => this.stop()
        });
    }

    /**
     * Generate a secure random secret key
     */
    private generateSecretKey(): string {
        // Create a random string of 32 characters
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';

        // Use crypto.randomBytes for cryptographically secure random key generation
        // No fallback - if this fails, we should let the error propagate
        const randomBytes = crypto.randomBytes(32);
        for (let i = 0; i < randomBytes.length; i++) {
            result += chars[randomBytes[i] % chars.length];
        }

        return result;
    }

    /**
     * Start the Goose server
     */
    public async start(): Promise<boolean> {
        this.logger.info('[ServerManager.start] Method entered.'); // New log
        if (this.status !== ServerStatus.STOPPED) {
            this.logger.info(`Server start called but status is ${this.status}.`);
            // Return true if already running, false otherwise (e.g. starting, error)
            return this.status === ServerStatus.RUNNING;
        }

        this.serverFullyStarted = false;

        // --- Load Configuration ---
        if (!this.configLoadAttempted) { // Attempt loading only once per instance lifecycle or restart
            const config = readGooseConfig();
            this.gooseProvider = config.provider;
            this.gooseModel = config.model;
            this.configLoadAttempted = true; // Mark as attempted

            // --- Validate Configuration ---
            if (!this.gooseProvider || !this.gooseModel) {
                const missing = [];
                if (!this.gooseProvider) { missing.push('GOOSE_PROVIDER'); }
                if (!this.gooseModel) { missing.push('GOOSE_MODEL'); }
                const errorMsg = `Goose: Failed to load required configuration (${missing.join(', ')}) from config file. Please ensure ~/.config/goose/config.yaml (or Windows equivalent) exists and contains valid GOOSE_PROVIDER and GOOSE_MODEL keys.`;
                this.logger.error(errorMsg);
                vscode.window.showErrorMessage(errorMsg);
                this.setStatus(ServerStatus.ERROR); // Set error status
                this.eventEmitter.emit(ServerEvents.ERROR, new Error(errorMsg)); // Emit error event
                return false; // Prevent server start
            }
            // --- End Validate Configuration ---
        }
        // --- End Load Configuration ---

        // Generate a new secret key each time we start the server
        this.secretKey = this.generateSecretKey();

        this.setStatus(ServerStatus.STARTING);
        this.logger.info('Starting Goose server...');

        // Log partial secret key for debugging (without revealing the full key)
        const keyPrefix = this.secretKey.substring(0, 4);
        const keySuffix = this.secretKey.substring(this.secretKey.length - 4);
        this.logger.debug(`Using secret key: ${keyPrefix}...${keySuffix} (${this.secretKey.length} chars)`);

        try {
            // Configure and start the server
            const serverConfig: GooseServerConfig = {
                workingDir: this.getWorkspaceDirectory(),
                getBinaryPath: (binaryName: string) => this.getBinaryPathFn(this.context, binaryName),
                logger: {
                    info: (message: string, ...args: any[]) => this.logger.info(`[GooseServer] ${message}`, ...args),
                    error: (message: string, ...args: any[]) => this.logger.error(`[GooseServer] ${message}`, ...args)
                },
                events: this.extensionEvents,
                secretKey: this.secretKey
            };

            // Use the stored startGoosed function
            this.serverInfo = await this.startGoosedFn(serverConfig);

            // Set up process exit handler
            this.serverInfo.process.on('close', (code, signal) => {
                const exitReason = signal ? `signal ${signal}` : `code ${code}`;
                this.logger.warn(`[ServerManager] 'close' event on server process: Process exited due to ${exitReason}.`);

                const wasRunningAndFullyStarted = this.serverFullyStarted;
                const previousStatus = this.status;

                this.serverInfo = null;
                this.apiClient = null;
                this.serverFullyStarted = false;
                this.configLoadAttempted = false;

                if (previousStatus === ServerStatus.STOPPING || previousStatus === ServerStatus.STOPPED) {
                    this.logger.info(`[ServerManager] Server process exited during or after a stop sequence. Current status: ${previousStatus}. Final status: STOPPED.`);
                    this.setStatus(ServerStatus.STOPPED);
                } else if (code !== null && code !== 0) {
                    this.logger.error(`[ServerManager] Server process exited unexpectedly with error code: ${code}. Previous status: ${previousStatus}. Setting status to ERROR.`);
                    this.setStatus(ServerStatus.ERROR);
                } else if (code === null) { // Covers signals (where signal arg might be present) or other null code exits
                    const reason = signal ? `due to signal: ${signal}` : "with null exit code (abnormal termination)";
                    this.logger.warn(`[ServerManager] Server process exited unexpectedly ${reason}. Previous status: ${previousStatus}. Setting status to ERROR.`);
                    this.setStatus(ServerStatus.ERROR);
                } else if (!wasRunningAndFullyStarted) { // code must be 0 here if this branch is reached
                    this.logger.warn(`[ServerManager] Server process exited (code 0) but was not fully started. Previous status: ${previousStatus}. Setting status to ERROR.`);
                    this.setStatus(ServerStatus.ERROR);
                } else { // code === 0 AND wasRunningAndFullyStarted
                    this.logger.info(`[ServerManager] Server process exited cleanly (code 0) after being fully started. Previous status: ${previousStatus}. Setting status to STOPPED.`);
                    this.setStatus(ServerStatus.STOPPED);
                }

                let eventPayload: number | string | null = null;
                if (code !== null) {
                    eventPayload = code;
                } else if (signal) {
                    eventPayload = signal;
                }
                // If code is null and signal is null/undefined, eventPayload remains null.
                this.eventEmitter.emit(ServerEvents.SERVER_EXIT, eventPayload);
            });

            this.serverInfo.process.on('error', (err) => {
                this.logger.error('[ServerManager] Error event on server process:', err);
                // This might indicate a failure to spawn or an OS-level error with the process
                this.serverFullyStarted = false;
                this.configLoadAttempted = false;
                if (this.status !== ServerStatus.STOPPED && this.status !== ServerStatus.ERROR) {
                    this.setStatus(ServerStatus.ERROR);
                }
                this.eventEmitter.emit(ServerEvents.ERROR, err);
            });

            // Create API client for the server
            this.apiClient = new this.ApiClientConstructor({ // Use ApiClientConstructor
                baseUrl: `http://127.0.0.1:${this.serverInfo.port}`,
                secretKey: this.secretKey,
                logger: singletonLogger, // Pass the singleton logger
                events: this.extensionEvents,
                // debug flag is now handled by the logger's level itself
            });

            // Await agent configuration
            await this.configureAgent();

            this.setStatus(ServerStatus.RUNNING);
            this.logger.info('Goose server is running and agent configured.');
            this.serverFullyStarted = true; // Server started successfully
            return true; // Return true on successful start and configuration
        } catch (error: any) {
            this.logger.error('Error starting Goose server:', error);
            this.serverFullyStarted = false; // Ensure flag is false on error

            // Check for specific binary not found error
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('find the') && errorMessage.includes('executable')) {
                // The error message from getBinaryPath already includes instructions and shows a VS Code notification
                // So we don't need to show another message, just set the status to ERROR
                this.logger.error('Failed to find Goose Desktop installation. Please install it from https://block.github.io/goose/');
            } else {
                // For other errors, show a generic error message
                vscode.window.showErrorMessage(
                    `Failed to start Goose server: ${errorMessage}. Please check logs for details.`,
                    { modal: false }
                );
            }

            this.setStatus(ServerStatus.ERROR); // Set status
            this.eventEmitter.emit(ServerEvents.ERROR, error); // Emit event
            return false; // Return false at the very end of the catch block
        }
    }

    /**
     * Configure the agent with appropriate provider and settings
     */
    private async configureAgent(): Promise<void> {
        if (!this.apiClient) {
            this.logger.error('API client not initialized, cannot configure agent.');
            vscode.window.showErrorMessage('Cannot configure AI provider: API client is not ready.');
            return;
        }

        try {
            // Ensure provider and model are set before creating agent
            if (!this.gooseProvider || !this.gooseModel) {
                this.logger.error('Goose provider or model is not set. Cannot create agent.');
                // Optionally, notify the user or throw an error
                this.eventEmitter.emit('error', 'Goose provider or model not configured in .goose.yaml');
                return; // Prevent agent creation if config is missing
            }

            // Step 1: Get available agent versions
            this.logger.info("Fetching agent versions...");
            const versionsInfo = await this.apiClient.getAgentVersions();
            const agentVersion = versionsInfo.default_version; // Use the default version

            // Step 2: Add the 'developer' extension (Trying this before createAgent)
            this.logger.info("Adding 'developer' extension to agent...");
            await this.apiClient.addExtension('developer');

            // Step 3: Create the agent using the fetched version
            this.logger.info(`Configuring agent with provider: ${this.gooseProvider}, model: ${this.gooseModel || 'default'}, version: ${agentVersion}`);
            await this.apiClient.createAgent(this.gooseProvider, this.gooseModel, agentVersion);

            // Step 4: Set the initial system prompt
            this.logger.info("Setting initial agent system prompt...");
            await this.apiClient.setAgentPrompt(vscodePrompt); // Use the defined prompt

            this.logger.info("Agent configuration complete.");

        } catch (error) {
            this.logger.error('Error configuring agent:', error);
            this.eventEmitter.emit(ServerEvents.ERROR, error);
            throw error;
        }
    }

    /**
     * Stop the Goose server
     */
    public stop(): void {
        if (this.serverInfo?.process && this.status !== ServerStatus.STOPPING && this.status !== ServerStatus.STOPPED) {
            this.logger.info(`[ServerManager] stop() called. Current status: ${this.status}. Setting status to STOPPING.`);
            this.setStatus(ServerStatus.STOPPING); // Indicate we are in the process of stopping
            this.serverFullyStarted = false;

            try {
                if (process.platform === 'win32' && this.serverInfo.process.pid) {
                    const { spawn } = require('child_process');
                    spawn('taskkill', ['/pid', this.serverInfo.process.pid.toString(), '/T', '/F']);
                } else {
                    this.serverInfo.process.kill();
                }
            } catch (error) {
                this.logger.error('Error stopping Goose server:', error);
            }

            this.serverInfo = null;
            this.apiClient = null;
            this.configLoadAttempted = false; // Allow re-loading config on next start/restart
            this.serverFullyStarted = false; // Ensure it's false after stopping
            this.setStatus(ServerStatus.STOPPED);
        }
    }

    /**
     * Restart the Goose server
     */
    public async restart(): Promise<boolean> {
        this.stop();
        return await this.start();
    }

    /**
     * Get the server status
     */
    public getStatus(): ServerStatus {
        return this.status;
    }

    /**
     * Get the API client
     */
    public getApiClient(): ActualApiClient | null {
        return this.apiClient;
    }



    /**
     * Get the secret key
     */
    public getSecretKey(): string {
        return this.secretKey;
    }

    /**
     * Check if the server is ready to handle requests
     */
    public isReady(): boolean {
        return this.status === ServerStatus.RUNNING && this.apiClient !== null;
    }

    /**
     * Set the server status and emit an event
     */
    private setStatus(status: ServerStatus) {
        this.status = status;
        this.eventEmitter.emit(ServerEvents.STATUS_CHANGE, status);
        // Also emit a general event for extension to listen to
        this.extensionEvents.emit('statusChanged', status);
        this.logger.info(`Server status changed to ${status}`);
    }

    /**
     * Add event listener for both ServerEvents and custom events
     */
    public on(event: ServerEvents | string, listener: (...args: any[]) => void): void {
        if (Object.values(ServerEvents).includes(event as ServerEvents)) {
            this.eventEmitter.on(event, listener);
        } else {
            this.extensionEvents.on(event, listener);
        }
    }

    /**
     * Unsubscribe from server events
     */
    public off(event: ServerEvents, listener: (...args: any[]) => void): void {
        this.eventEmitter.off(event, listener);
    }

    private getBinaryPath(): string {
        // Use the utility function to get the binary path
        return this.getBinaryPathFn(this.context, 'goosed');
    }

    private getWorkspaceDirectory(): string {
        // Implement the logic to get the workspace directory
        // This is a placeholder and should be replaced with the actual implementation
        return process.cwd();
    }
}
