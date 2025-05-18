// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ColorThemeKind } from 'vscode'; // Import ColorThemeKind
import * as path from 'path';
import * as fs from 'fs';
import { ServerManager, ServerStatus, ServerEvents } from './server/serverManager';
import { ChatProcessor, ChatEvents } from './server/chat/chatProcessor';
import { Message, getTextContent } from './types';
// Import CodeReference type explicitly if needed, or rely on CodeReferenceManager export
import { CodeReferenceManager, CodeReference } from './utils/codeReferenceManager';
import { WorkspaceContextProvider } from './utils/workspaceContextProvider';
import { GooseCodeActionProvider } from './utils/codeActionProvider';
import { SessionManager, SessionEvents } from './server/chat/sessionManager';
// Import MessageType from common types
import { MessageType } from './common-types';
// Import config reader function
import { getConfigFilePath } from './utils/configReader';
// Import the new logger singleton
import { logger } from './utils/logger';
// Import version utility
import { getExtensionVersion } from './utils/versionUtils';

// Create logger for the extension
// const logger = getLogger('Extension'); // OLD LOGGER REMOVED

// Define line limit constant for prepending code vs. adding reference chip
const SELECTION_LINE_LIMIT_FOR_PREPEND = 100;

// Interface for messages sent between extension and webview
interface WebviewMessage {
	command: string;
	[key: string]: any; // Additional properties
}

/**
 * Manages webview panels and sidebar view
 */
export class GooseViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'goose.chatView';
	private _view?: vscode.WebviewView;
	private isWebviewReady = false; // Added for readiness check
	private messageQueue: WebviewMessage[] = []; // Added for message queueing
	private lastSentStatus: ServerStatus | undefined = undefined; // Added for status change check
	private readonly _extensionUri: vscode.Uri;
	private readonly _serverManager: ServerManager;
	private readonly _chatProcessor: ChatProcessor;
	private readonly _codeReferenceManager: CodeReferenceManager;
	private readonly _workspaceContextProvider: WorkspaceContextProvider;
	private readonly _sessionManager: SessionManager;

	constructor(extensionUri: vscode.Uri, serverManager: ServerManager, chatProcessor: ChatProcessor, sessionManager: SessionManager) {
		this._extensionUri = extensionUri;
		this._serverManager = serverManager;
		this._chatProcessor = chatProcessor;
		this._codeReferenceManager = CodeReferenceManager.getInstance();
		this._workspaceContextProvider = WorkspaceContextProvider.getInstance();
		this._sessionManager = sessionManager;
	}

	/**
	 * Maps VS Code theme kind to a shiki theme identifier.
	 * Uses 'light-plus' and 'dark-plus' as they are built-in themes in shiki
	 * that correspond well to VS Code's default light and dark themes.
	 * @param kind The VS Code theme kind.
	 * @returns A shiki theme identifier string.
	 */
	public getShikiTheme(kind: ColorThemeKind): string { // Made public for listener access
		switch (kind) {
			case ColorThemeKind.Light:
			case ColorThemeKind.HighContrastLight:
				return 'light-plus'; // Shiki's equivalent for Light+
			case ColorThemeKind.Dark:
			case ColorThemeKind.HighContrast:
				return 'dark-plus'; // Shiki's equivalent for Dark+
			default:
				return 'dark-plus'; // Default fallback
		}
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;

		// --- Detect and Map Theme ---
		const activeTheme = vscode.window.activeColorTheme;
		const shikiTheme = this.getShikiTheme(activeTheme.kind);
		logger.info(`Detected VS Code theme kind: ${ColorThemeKind[activeTheme.kind]}, Mapped to shiki theme: ${shikiTheme}`);
		// --- End Detect and Map Theme ---

		webviewView.webview.options = {
			// Enable scripts in the webview
			enableScripts: true,
			// Restrict the webview to only load resources from allowed directories
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, 'out'), // For extension's JS/CSS
				vscode.Uri.joinPath(this._extensionUri, 'webview-ui/dist'), // For webview's JS/CSS
				vscode.Uri.joinPath(this._extensionUri, 'resources') // For images and other static assets
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(async (message) => {
			await this._onDidReceiveMessage(message);
		});

		// Handle webview disposal
		webviewView.onDidDispose(() => {
			logger.info('Webview view disposed. Cleaning up resources.');
			this._view = undefined;
			this.isWebviewReady = false;
			this.messageQueue = []; // Clear any pending messages
		});

		// --- Add onDidChangeVisibility listener ---
		webviewView.onDidChangeVisibility(() => {
			if (this._view && this._view.visible) {
				logger.debug('[GooseViewProvider] Webview became visible. Re-syncing state.');
				this.isWebviewReady = true;

				const currentStatus = this._serverManager.getStatus();
				this.postMessage({ command: MessageType.SERVER_STATUS, status: currentStatus });
				this.lastSentStatus = currentStatus;

				this._processMessageQueue();

				const gooseIconUri = this._view?.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'goose-icon.png'));
				this.postMessage({ command: MessageType.RESOURCES_READY, resources: { gooseIcon: gooseIconUri?.toString() } });

				this.postMessage({ command: MessageType.SET_EXTENSION_VERSION, version: getExtensionVersion() });

				const activeTheme = vscode.window.activeColorTheme;
				this.postMessage({ command: MessageType.SET_THEME, theme: this.getShikiTheme(activeTheme.kind) });
			} else {
				logger.debug('[GooseViewProvider] Webview became hidden.');
			}
		});
		// --- End onDidChangeVisibility listener ---

		// Set up event listeners for server status changes
		this._serverManager.on(ServerEvents.STATUS_CHANGE, (newStatus: ServerStatus) => {
			if (newStatus !== this.lastSentStatus) {
				// logger.debug(`Server status changed to ${newStatus}. Last sent was ${this.lastSentStatus}. Sending update.`);
				this.postMessage({
					command: MessageType.SERVER_STATUS,
					status: newStatus
				});
				this.lastSentStatus = newStatus;
			}
		});

		// Set up event listeners for chat events
		this._chatProcessor.on(ChatEvents.MESSAGE_RECEIVED, (message: Message) => {
			this.postMessage({ // Use the new postMessage method
				command: MessageType.CHAT_RESPONSE,
				message: message
			});
		});

		this._chatProcessor.on(ChatEvents.ERROR, (error: Error) => {
			this.postMessage({ // Use the new postMessage method
				command: MessageType.ERROR,
				errorMessage: error.message
			});
		});

		this._chatProcessor.on(ChatEvents.FINISH, (message: Message, reason: string) => {
			this.postMessage({ // Use the new postMessage method
				command: MessageType.GENERATION_FINISHED,
				message,
				reason
			});
		});

		// Log that the view has been resolved
		logger.info(`Webview view resolved with context: ${context.state}`);

		// Send initial messages (will be queued if webview is not ready yet)
		const initialStatus = this._serverManager.getStatus();
		this.postMessage({
			command: MessageType.SERVER_STATUS,
			status: initialStatus
		});
		this.lastSentStatus = initialStatus;

		this.postMessage({
			command: MessageType.SET_THEME,
			theme: shikiTheme
		});
	}

	private async _onDidReceiveMessage(message: any) {
		switch (message.command) {
			case MessageType.WEBVIEW_READY: // Handle webview ready message
				logger.info('Webview is ready. Processing message queue.');
				this.isWebviewReady = true;
				this._processMessageQueue();

				// Send extension version to webview
				const extensionVersion = getExtensionVersion();
				logger.info(`Sending extension version to webview: ${extensionVersion}`);
				this.postMessage({
					command: MessageType.SET_EXTENSION_VERSION,
					version: extensionVersion
				});

				// Create and send proper webview URIs for resources
				const gooseIconUri = this._view?.webview.asWebviewUri(
					vscode.Uri.joinPath(this._extensionUri, 'resources', 'goose-icon.png')
				);
				logger.info(`Generated webview URI for goose-icon.png: ${gooseIconUri}`);
				this.postMessage({
					command: MessageType.RESOURCES_READY,
					resources: {
						gooseIcon: gooseIconUri?.toString()
					}
				});
				// Explicitly ensuring no SESSIONS_LIST is sent here.
				// Webview initiates session fetching via GET_SESSIONS.
				break;

			case MessageType.HELLO:
				break;

			case MessageType.GET_ACTIVE_EDITOR_CONTENT:
				this._getActiveEditorContent();
				break;

			case MessageType.SEND_CHAT_MESSAGE:
				// Check if there's text, explicit code references (chips), or prepended code
				if (message.text?.trim() || message.codeReferences?.length > 0 || message.prependedCode) {
					try {
						// Pass relevant data to the chat processor
						// Note: The signature of sendMessage might need adjustment in Task 1.6
						await this._chatProcessor.sendMessage(
							message.text,
							message.codeReferences, // Existing code reference chips
							message.prependedCode, // Pass the new prepended code data
							message.messageId,
							message.sessionId || this._sessionManager.getCurrentSessionId()
						);
					} catch (error) {
						logger.error('Error sending message to chat processor:', error); // Use logger
						this.postMessage({
							command: MessageType.ERROR,
							errorMessage: error instanceof Error ? error.message : String(error)
						});
					}
				} else {
					logger.warn('Received SEND_CHAT_MESSAGE with no content.');
				}
				break;

			case MessageType.STOP_GENERATION:
				this._chatProcessor.stopGeneration();
				break;

			case MessageType.REMOVE_CODE_REFERENCE:
				// Handle removing a code reference from the UI
				if (message.id) {
					logger.debug('Removing code reference with ID:', message.id);
					// Send back confirmation to the webview to update its state
					this.postMessage({
						command: MessageType.REMOVE_CODE_REFERENCE,
						id: message.id
					});
				}
				break;

			case MessageType.GET_SESSIONS:
				try {
					const sessions = await this._sessionManager.fetchSessions();
					this.postMessage({
						command: MessageType.SESSIONS_LIST,
						sessions
					});
				} catch (error) {
					logger.error('Error fetching sessions:', error);
					this.postMessage({
						command: MessageType.ERROR,
						error: 'Failed to fetch sessions'
					});
				}
				break;

			case MessageType.SWITCH_SESSION:
				try {
					const success = await this._sessionManager.switchSession(message.sessionId);
					if (success) {
						const session = this._sessionManager.getCurrentSession();
						if (session) {
							this.postMessage({
								command: MessageType.SESSION_LOADED,
								sessionId: session.session_id,
								messages: session.messages
							});
						}
					} else {
						this.postMessage({
							command: MessageType.ERROR,
							error: 'Failed to switch session'
						});
					}
				} catch (error) {
					logger.error('Error switching session:', error);
					this.postMessage({
						command: MessageType.ERROR,
						error: 'Failed to switch session'
					});
				}
				break;

			case MessageType.CREATE_SESSION:
				try {
					const workspaceDirectory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
					if (!workspaceDirectory) {
						this.postMessage({
							command: MessageType.ERROR,
							error: 'No workspace folder found'
						});
						return;
					}

					const sessionId = await this._sessionManager.createSession(
						workspaceDirectory,
						message.description
					);

					if (sessionId) {
						// Get the session data to send to the webview
						const session = this._sessionManager.getCurrentSession();
						if (session) {
							this.postMessage({
								command: MessageType.SESSION_LOADED,
								sessionId: session.session_id,
								messages: session.messages
							});

							// Also send the updated session list
							this.postMessage({
								command: MessageType.SESSIONS_LIST,
								sessions: this._sessionManager.getSessions()
							});
						}
					} else {
						this.postMessage({
							command: MessageType.ERROR,
							error: 'Failed to create session'
						});
					}
				} catch (error) {
					logger.error('Error creating session:', error);
					this.postMessage({
						command: MessageType.ERROR,
						error: 'Failed to create session'
					});
				}
				break;

			case MessageType.RENAME_SESSION:
				try {
					// Get current session or let user pick one
					let sessionId = this._sessionManager.getCurrentSessionId();
					let sessionDescription = '';

					if (!sessionId) {
						// Fetch available sessions
						const sessions = await this._sessionManager.fetchSessions();

						if (sessions.length === 0) {
							vscode.window.showInformationMessage('No sessions available to rename.');
							return;
						}

						// Create quick pick items from session list
						const sessionItems = sessions.map(session => ({
							label: session.metadata.description || `Session ${session.id}`,
							description: new Date(session.modified).toLocaleString(),
							detail: `${session.metadata.message_count} messages`,
							id: session.id
						}));

						// Show quick pick menu
						const selectedItem = await vscode.window.showQuickPick(sessionItems, {
							placeHolder: 'Select a session to rename'
						});

						if (!selectedItem) {
							return; // User cancelled
						}

						sessionId = selectedItem.id;
						sessionDescription = selectedItem.label;
					} else {
						// Get current session description
						const currentSession = this._sessionManager.getCurrentSession();
						if (currentSession) {
							sessionDescription = currentSession.metadata.description;
						}
					}

					// Get new description from user
					const newDescription = await vscode.window.showInputBox({
						placeHolder: 'Enter a new description for the session',
						prompt: 'This helps identify your session later',
						value: sessionDescription
					});

					if (newDescription !== undefined && sessionId) { // User didn't cancel
						const apiClient = this._serverManager.getApiClient();
						if (apiClient) {
							const result = await apiClient.renameSession(sessionId, newDescription);
							if (result) {
								vscode.window.showInformationMessage(`Renamed session to: ${newDescription}`);

								// Refresh sessions and notify webview
								await this._sessionManager.fetchSessions();
								this.postMessage({
									command: MessageType.SESSIONS_LIST,
									sessions: this._sessionManager.getSessions()
								});
							} else {
								vscode.window.showErrorMessage('Failed to rename session');
							}
						}
					}
				} catch (error) {
					logger.error('Error renaming session:', error);
					vscode.window.showErrorMessage('Failed to rename session');
				}
				break;

			case MessageType.DELETE_SESSION:
				try {
					// Fetch available sessions
					const sessions = await this._sessionManager.fetchSessions();

					if (sessions.length === 0) {
						vscode.window.showInformationMessage('No sessions available to delete.');
						return;
					}

					// Create quick pick items from session list
					const sessionItems = sessions.map(session => ({
						label: session.metadata.description || `Session ${session.id}`,
						description: new Date(session.modified).toLocaleString(),
						detail: `${session.metadata.message_count} messages`,
						id: session.id
					}));

					// Show quick pick menu
					const selectedItem = await vscode.window.showQuickPick(sessionItems, {
						placeHolder: 'Select a session to delete'
					});

					if (!selectedItem) {
						return; // User cancelled
					}

					// Confirm deletion
					const confirmed = await vscode.window.showWarningMessage(
						`Are you sure you want to delete "${selectedItem.label}"?`,
						{ modal: true },
						'Delete'
					);

					if (confirmed === 'Delete') {
						const apiClient = this._serverManager.getApiClient();
						if (apiClient) {
							const result = await apiClient.deleteSession(selectedItem.id);
							if (result) {
								vscode.window.showInformationMessage(`Deleted session: ${selectedItem.label}`);

								// If we deleted the current session, switch to a new one
								if (selectedItem.id === this._sessionManager.getCurrentSessionId()) {
									// Create a new session or switch to another one
									if (sessions.length > 1) {
										// Find a different session to switch to
										const differentSession = sessions.find(s => s.id !== selectedItem.id);
										if (differentSession) {
											await this._sessionManager.switchSession(differentSession.id);
										}
									} else {
										// Create a new session if this was the only one
										vscode.commands.executeCommand('goose.createSession');
									}
								}

								// Refresh sessions and notify webview
								await this._sessionManager.fetchSessions();
								this.postMessage({
									command: MessageType.SESSIONS_LIST,
									sessions: this._sessionManager.getSessions()
								});
							} else {
								vscode.window.showErrorMessage('Failed to delete session');
							}
						}
					}
				} catch (error) {
					logger.error('Error deleting session:', error);
					vscode.window.showErrorMessage('Failed to delete session');
				}
				break;

			case MessageType.GET_SERVER_STATUS:
				// logger.debug(`Received GET_SERVER_STATUS from webview. Current actual status: ${this._serverManager.getStatus()}. Sending.`);
				this.postMessage({
					command: MessageType.SERVER_STATUS,
					status: this._serverManager.getStatus()
				});
				break;

			case MessageType.RESTART_SERVER:
				logger.info('Restarting Goose server...');
				// Restart the server
				this._serverManager.restart().then(success => {
					// Send updated status
					this.postMessage({
						command: MessageType.SERVER_STATUS,
						status: this._serverManager.getStatus()
					});

					if (success) {
						logger.info('Server restarted successfully');
					} else {
						logger.error('Failed to restart server');
						this.postMessage({
							command: MessageType.ERROR,
							errorMessage: 'Failed to restart the Goose server'
						});
					}
				});
				break;

			case MessageType.OPEN_SETTINGS_FILE:
				try {
					const configPath = getConfigFilePath(); // Use the imported function
					if (configPath) {
						const uri = vscode.Uri.file(configPath);
						try {
							const doc = await vscode.workspace.openTextDocument(uri);
							await vscode.window.showTextDocument(doc);
							logger.info(`Opened settings file: ${configPath}`);
						} catch (err) {
							logger.error(`Failed to open settings file at ${configPath}:`, err);
							vscode.window.showErrorMessage(`Could not open settings file. It might not exist or there was a read error. Expected location: ${configPath}`);
						}
					} else {
						logger.error('Could not determine the path to the settings file.');
						vscode.window.showErrorMessage('Could not determine the path to the Goose settings file for your OS.');
					}
				} catch (error) {
					logger.error('Error handling OPEN_SETTINGS_FILE:', error);
					vscode.window.showErrorMessage('An unexpected error occurred while trying to open the settings file.');
				}
				break;

			default:
				logger.warn(`Unhandled message: ${message.command}`);
		}
	}

	private _getActiveEditorContent() {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const document = editor.document;
			const content = document.getText();
			const fileName = document.fileName;
			const languageId = document.languageId;

			this.postMessage({
				command: MessageType.ACTIVE_EDITOR_CONTENT,
				content,
				fileName,
				languageId,
			});
		} else {
			this.postMessage({
				command: MessageType.ERROR,
				errorMessage: 'No active editor found'
			});
		}
	}

	/**
	 * Processes the message queue, sending messages to the webview if it's ready.
	 */
	private _processMessageQueue() {
		logger.debug(`Processing message queue. ${this.messageQueue.length} messages pending.`);
		while (this.messageQueue.length > 0) {
			const message = this.messageQueue.shift();
			if (message) {
				logger.debug(`Dequeuing and sending message: ${message.command}`);
				this._postMessageInternal(message); // Use internal method to send
			}
		}
	}

	/**
	 * Internal method to actually send a message to the webview.
	 * Should only be called when the webview is known to be available.
	 */
	private async _postMessageInternal(message: WebviewMessage): Promise<boolean> {
		if (this._view && this._view.webview) {
			try {
				logger.debug(`Sending message to webview: ${message.command}`, message.command === 'aiMessageChunk' ? undefined : message);
				const result = await this._view.webview.postMessage(message);
				logger.debug(`Successfully posted message to webview: ${message.command}`);
				if (message.command === 'aiMessage') {
					logger.debug(`Sent full AI message with ID: ${message.message.id}`);
				}
				return true;
			} catch (error) {
				logger.error(`Error posting message ${message.command} to webview:`, error);
				return false;
			}
		} else {
			// This case should ideally be caught by the public postMessage queueing logic
			logger.warn(`_postMessageInternal called but webview is not available. Message: ${message.command}`);
			return false;
		}
	}

	/**
	 * Public method to send a message to the webview.
	 * Queues messages if the webview is not ready.
	 */
	public postMessage(message: WebviewMessage) {
		if (this._view && this.isWebviewReady) {
			this._postMessageInternal(message);
		} else if (this._view) {
			logger.debug(`Webview not ready, queuing message: ${message.command}`);
			this.messageQueue.push(message);
		} else {
			logger.warn(`Webview panel is undefined, cannot send or queue message: ${message.command}`);
		}
	}


	private _getHtmlForWebview(webview: vscode.Webview) {
		// Path to the built webview UI
		const distPath = vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'dist');
		const webviewDistPath = webview.asWebviewUri(distPath);

		// Get paths to CSS and JS files
		const indexPath = path.join(this._extensionUri.fsPath, 'webview-ui', 'dist', 'index.html');

		// Read the file
		let indexHtml = fs.readFileSync(indexPath, 'utf8');

		// Update the asset paths to be webview-friendly
		indexHtml = indexHtml.replace(
			/(href|src)="([^"]*)"/g,
			(match, p1, p2) => {
				// Skip external URLs and data URLs
				if (p2.startsWith('http') || p2.startsWith('data:')) {
					return match;
				}
				return `${p1}="${webviewDistPath.toString()}/${p2}"`;
			}
		);

		return indexHtml;
	}

	/**
	 * Adds a code reference to the chat input
	 */
	public addCodeReference() {
		const codeReference = this._codeReferenceManager.getCodeReferenceFromSelection();
		if (codeReference) {
			this.postMessage({
				command: MessageType.ADD_CODE_REFERENCE,
				codeReference
			});
		} else {
			vscode.window.showInformationMessage('Please select some code first');
		}
	}

	/**
	 * Adds the current diagnostics to the chat
	 */
	public async addCurrentDiagnostics() {
		const diagnostics = this._workspaceContextProvider.getCurrentDiagnostics();
		const formattedDiagnostics = this._workspaceContextProvider.formatDiagnostics(diagnostics);
		const currentFile = this._workspaceContextProvider.getCurrentFileName();

		if (diagnostics.length === 0) {
			this.postMessage({
				command: MessageType.CHAT_MESSAGE,
				text: `No issues found in ${currentFile || 'the current file'}.`
			});
		} else {
			this.postMessage({
				command: MessageType.CHAT_MESSAGE,
				text: `Please help me fix these issues in ${currentFile || 'my code'}:\n\n${formattedDiagnostics}`
			});
		}

		vscode.commands.executeCommand('goose.chatView.focus');
	}

	// Add event handler to confirm message was sent to webview
	// This method seems redundant now with the public postMessage.
	// Keeping it for now if it's used externally, but consider removing if not.
	public async sendMessageToWebview(message: any): Promise<boolean> {
		// For now, let's assume it should use the new public postMessage logic.
		// However, postMessage is void, so this signature needs to change or the method needs a different purpose.
		// For now, just calling postMessage and returning a placeholder.
		// This needs review based on how sendMessageToWebview is used.
		this.postMessage(message);
		return Promise.resolve(true); // Placeholder, as postMessage is void.
	}
}

// --- Exportable Handler Logic --- 
// Added export
export async function handleAskAboutSelectionCommand(
	provider: GooseViewProvider,
	codeReferenceManager: CodeReferenceManager
) {
	logger.info('Executing command: goose.askAboutSelection');

	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		logger.warn('No active text editor found.');
		vscode.window.showInformationMessage('No active text editor.');
		return;
	}

	const document = editor.document;
	const selection = editor.selection;

	let codeReferenceToSend: CodeReference | null = null;
	let prepayloadToSend: any | null = null; // Payload for PREPARE_MESSAGE_WITH_CODE
	let actionTaken = false; // Flag to track if we should focus

	if (selection.isEmpty) {
		// Task 1.2: No selection - use whole file
		const fileContent = document.getText();
		if (!fileContent || fileContent.trim() === '') { // Updated check
			vscode.window.showInformationMessage('Active file is empty or contains only whitespace.');
			return;
		}
		const fileName = path.basename(document.fileName);
		const lineCount = document.lineCount;

		if (lineCount >= SELECTION_LINE_LIMIT_FOR_PREPEND) {
			// Use the new method for whole file referencing
			codeReferenceToSend = codeReferenceManager.getCodeReferenceForEntireFile(document);
			// getCodeReferenceForEntireFile already checks for empty/whitespace content
			// and returns null, so no need for an additional check here if it's null.
			// However, if it *is* null, we might want to inform the user, though it's covered by the initial check.
			if (codeReferenceToSend) {
				logger.info(`File >= ${SELECTION_LINE_LIMIT_FOR_PREPEND} lines, creating code reference chip for whole file.`);
				actionTaken = true;
			} else {
				// This case should theoretically be caught by the initial fileContent.trim() check.
				// If it still happens, it's an unexpected state or a bug in getCodeReferenceForEntireFile.
				logger.warn('getCodeReferenceForEntireFile returned null for a non-empty, non-whitespace file.');
				vscode.window.showInformationMessage('Could not create a reference for the file.');
				return;
			}
		} else {
			// Prepending whole file (already checked for empty/whitespace)
			prepayloadToSend = {
				content: fileContent,
				fileName: fileName,
				languageId: document.languageId,
				startLine: 1,
				endLine: lineCount > 0 ? lineCount : 1
			};
			logger.info(`File < ${SELECTION_LINE_LIMIT_FOR_PREPEND} lines, preparing message with whole file code.`);
			actionTaken = true;
		}
	} else {
		// User has made a selection
		const selectedLines = selection.end.line - selection.start.line + 1;

		if (selectedLines >= SELECTION_LINE_LIMIT_FOR_PREPEND) {
			// Task 1.3: >= 100 lines - use manager to create code reference chip
			codeReferenceToSend = codeReferenceManager.getCodeReferenceFromSelection();
			if (!codeReferenceToSend) {
				// This means selection was empty or whitespace only
				vscode.window.showInformationMessage('Selected text is empty or contains only whitespace.');
				return;
			}
			logger.info(`Selection >= ${SELECTION_LINE_LIMIT_FOR_PREPEND} lines, creating code reference chip.`);
			actionTaken = true;
		} else {
			// Task 1.4: < 100 lines - prepare message with code
			const selectedText = document.getText(selection);
			if (selectedText.trim() === '') { // Added check
				vscode.window.showInformationMessage('Selected text is empty or contains only whitespace.');
				return;
			}
			// Construct a full CodeReference object for the prepayload
			const filePath = document.uri.fsPath;
			const fileName = path.basename(filePath);
			prepayloadToSend = {
				id: `${fileName}-${selection.start.line + 1}-${selection.end.line + 1}-${Date.now()}`, // Generate an ID
				filePath: filePath,
				fileName: fileName,
				selectedText: selectedText, // Use selectedText instead of content
				languageId: document.languageId,
				startLine: selection.start.line + 1,
				endLine: selection.end.line + 1
			} as CodeReference; // Cast to CodeReference to ensure all fields are there
			logger.info(`Selection < ${SELECTION_LINE_LIMIT_FOR_PREPEND} lines (${prepayloadToSend.startLine}-${prepayloadToSend.endLine}), preparing message with code (as CodeReference).`);
			actionTaken = true;
		}
	}

	// Send the appropriate message to the webview
	if (codeReferenceToSend) {
		provider.postMessage({ // Use the passed provider
			command: MessageType.ADD_CODE_REFERENCE,
			codeReference: codeReferenceToSend
		});
	} else if (prepayloadToSend) {
		provider.postMessage({ // Use the passed provider
			command: MessageType.PREPARE_MESSAGE_WITH_CODE,
			payload: prepayloadToSend
		});
	}

	// Focus the chat view and input only if an action was taken
	if (actionTaken) {
		vscode.commands.executeCommand('goose.chatView.focus');
		provider.postMessage({ // Use the passed provider
			command: MessageType.FOCUS_CHAT_INPUT
		});
	}
}
// --- End Exportable Handler Logic ---

export function activate(context: vscode.ExtensionContext) {

	// Initialize logger first
	logger.info('Goose extension activating...');

	// Get config path
	const configFilePath = getConfigFilePath();
	logger.info(`Using config file at: ${configFilePath}`);

	// Create the ServerManager instance
	const serverManager = new ServerManager(context);

	// Now create instances that depend on serverManager (assuming dependencies)
	const sessionManager = new SessionManager(serverManager);
	const chatProcessor = new ChatProcessor(serverManager);

	// Create the provider instance, passing managers
	const provider = new GooseViewProvider(
		context.extensionUri,
		serverManager, // Pass serverManager
		chatProcessor, // Pass chatProcessor
		sessionManager // Pass sessionManager
	);

	// Get the code reference manager instance
	const codeReferenceManager = CodeReferenceManager.getInstance();

	// Register the view provider
	const viewRegistration = vscode.window.registerWebviewViewProvider(GooseViewProvider.viewType, provider);

	// Register "Hello World" command
	const helloDisposable = vscode.commands.registerCommand('goose.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Goose!');
	});

	// Register Start/Stop commands for the server
	const startServerDisposable = vscode.commands.registerCommand('goose.startServer', () => {
		serverManager.start();
	});
	const stopServerDisposable = vscode.commands.registerCommand('goose.stopServer', () => {
		serverManager.stop();
	});

	// Register command to open settings
	const openSettingsDisposable = vscode.commands.registerCommand('goose.openSettings', () => {
		// Construct the search query for the extension settings
		// The format `@ext:` is used to filter settings by a specific extension
		vscode.commands.executeCommand('workbench.action.openSettings', '@ext:block.vscode-goose');
	});

	// Register command to ask about selected code
	// --->>> UPDATED: Use the exported handler
	const askAboutSelectionDisposable = vscode.commands.registerCommand('goose.askAboutSelection',
		() => handleAskAboutSelectionCommand(provider, codeReferenceManager) // Pass dependencies
	);

	// Register Code Action provider
	const codeActionRegistration = vscode.languages.registerCodeActionsProvider(
		{ scheme: 'file' }, // Apply to all file types
		new GooseCodeActionProvider()
	);

	// Register session management commands
	const listSessionsDisposable = vscode.commands.registerCommand('goose.listSessions', async () => {
		try {
			logger.info('Executing command: goose.listSessions');
			const sessions = await sessionManager.fetchSessions();
			// Sessions are fetched and cached.
			// The webview will request the list via GET_SESSIONS when it needs it.
			// No need to proactively push to the webview here.
			// if (provider) {
			// provider.postMessage({
			// command: MessageType.SESSIONS_LIST,
			// sessions
			// });
			// }
		} catch (error) {
			logger.error('Error executing goose.listSessions command:', error);
			vscode.window.showErrorMessage(`Failed to list sessions: ${error}`);
		}
	});

	// --- Add Theme Change Listener ---
	const themeChangeListener = vscode.window.onDidChangeActiveColorTheme(theme => {
		const newShikiTheme = provider.getShikiTheme(theme.kind);
		logger.info(`VS Code theme changed. New kind: ${ColorThemeKind[theme.kind]}, Mapped shiki theme: ${newShikiTheme}`);
		// Use the new postMessage method
		provider.postMessage({
			command: MessageType.SET_THEME,
			theme: newShikiTheme
		});
	});
	// --- End Theme Change Listener ---

	// --- Add Configuration Change Listener for Logging ---
	const loggingConfigListener = vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('goose.logging.enabled') || event.affectsConfiguration('goose.logging.level')) {
			logger.info('Logging configuration changed, updating logger...');
			logger.updateConfiguration();
		}
	});
	// --- End Configuration Change Listener ---

	// Register command to show logs
	const showLogsDisposable = vscode.commands.registerCommand('goose.showLogs', () => {
		logger.info('Executing command: goose.showLogs');
		logger.showOutputChannel();
	});

	// Add all disposables to the extension context's subscriptions
	context.subscriptions.push(
		viewRegistration,
		helloDisposable,
		startServerDisposable,
		stopServerDisposable,
		openSettingsDisposable, // Add open settings disposable
		askAboutSelectionDisposable,
		codeActionRegistration,
		listSessionsDisposable,
		themeChangeListener,
		loggingConfigListener,
		showLogsDisposable
	);

	logger.info('[Activate] About to call serverManager.start()'); // New log
	// Start the server (if not already running and enabled)
	serverManager.start().then(started => {
		if (started) {
			logger.info('[Activate] ServerManager.start() promise resolved true (started successfully).');
		} else {
			logger.info('[Activate] ServerManager.start() promise resolved false (did not start, e.g., config error, already running).');
		}
	}).catch(error => {
		logger.error('[Activate] ServerManager.start() promise rejected with error:', error);
	});

	logger.info('Goose extension activated.');
}

// This method is called when your extension is deactivated
export function deactivate() { }
