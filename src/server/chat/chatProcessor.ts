import { EventEmitter } from 'events';
import { TextDecoder } from 'util';
import { ServerManager } from '../serverManager';
import { Message, MessageContent, TextPart, CodeContextPart } from '../../types'; // Updated imports
import * as vscode from 'vscode';
import { CodeReference } from '../../utils/codeReferenceManager'; // Added import
import { SessionManager, SessionEvents } from './sessionManager';
import { logger } from '../../utils/logger';

/**
 * Events emitted by the chat processor
 */
export enum ChatEvents {
    MESSAGE_RECEIVED = 'messageReceived',
    FINISH = 'finish',
    ERROR = 'error'
}

/**
 * Event types for SSE stream
 */
type MessageEvent =
    | { type: 'Message'; message: Message }
    | { type: 'Error'; error: string }
    | { type: 'Finish'; reason: string };

/**
 * Formats a user message with optional code context into the new <user-request> format.
 * If codeContext is provided, returns the formatted string; otherwise, returns the userQuery as-is.
 * @param userQuery The user's textual query.
 * @param codeContext Optional CodeContextPart containing code reference info.
 */
export function formatMessageWithCodeContext(
    userQuery: string,
    codeContext?: CodeContextPart
): string {
    if (!codeContext) {
        return userQuery;
    }

    const { filePath, fileName, selectedText, languageId } = codeContext;
    const codeLines = selectedText ? selectedText.split('\n') : [];
    const lineCount = codeLines.length;

    let codeBlock = '';
    if (lineCount < 100 && selectedText.trim() !== '') {
        // Inline the code, indenting each line by two spaces
        const indentedCode = codeLines.map(line => `  ${line}`).join('\n');
        codeBlock = `  \`${languageId || ''}\n${indentedCode}\n  \`\n\n`;
    } else {
        // Instruct Goose to read the file
        codeBlock =
            `  \`${languageId || ''}\n` +
            `  // File content for '${fileName}' (${lineCount} lines) is not displayed inline. Goose, please read the file at '${filePath}'.\n` +
            `  \`\n\n`;
    }

    return `<user-request>
'${filePath}' (see below for file content)

${codeBlock}${userQuery}
</user-request>`;
}

/**
* Handles communication with the Goose server for chat functionality
*/
export class ChatProcessor {
    private serverManager: ServerManager;
    private eventEmitter: EventEmitter;
    private abortController: AbortController | null = null;
    private currentMessages: Message[] = [];
    private shouldStop: boolean = false;
    private sessionManager: SessionManager | null = null;

    constructor(serverManager: ServerManager) {
        this.serverManager = serverManager;
        this.eventEmitter = new EventEmitter();
    }

    /**
     * Set the session manager
     */
    public setSessionManager(sessionManager: SessionManager): void {
        this.sessionManager = sessionManager;
    }

    /**
     * Send a message to the Goose AI
     */
    public async sendMessage(
        text: string,
        codeReferencesParam?: CodeReference[],
        prependedCode?: CodeReference,
        messageId?: string,
        sessionId?: string
    ): Promise<void> {
        const hasText = text && text.trim() !== '';
        const hasCodeReferences = codeReferencesParam && codeReferencesParam.length > 0;
        const hasPrependedCode = !!prependedCode;

        if (!hasText && !hasCodeReferences && !hasPrependedCode) {
            logger.info('ChatProcessor: sendMessage called with empty user text and no code context. Not proceeding.');
            return;
        }

        let effectiveSessionId: string | undefined = sessionId;

        if (!effectiveSessionId && this.sessionManager) {
            const currentSessionId = this.sessionManager.getCurrentSessionId();
            if (currentSessionId) {
                effectiveSessionId = currentSessionId;
            }
        }

        // Determine code context: prefer prependedCode, else first codeReferencesParam, else undefined
        let codeContext: CodeContextPart | undefined;
        if (prependedCode && prependedCode.selectedText && prependedCode.selectedText.trim() !== '') {
            codeContext = { ...prependedCode, type: 'code_context' };
        } else if (codeReferencesParam && codeReferencesParam.length > 0) {
            const firstValid = codeReferencesParam.find(
                ref => ref && typeof ref.selectedText === 'string' && ref.selectedText.trim() !== ''
            );
            if (firstValid) {
                codeContext = { ...firstValid, type: 'code_context' };
            }
        }

        // Use the formatting utility to produce the message string
        const formatted = formatMessageWithCodeContext(text ? text.trim() : '', codeContext);

        const userMessage: Message = {
            id: messageId || `user_${Date.now()}`,
            role: 'user',
            created: Date.now(),
            content: [
                {
                    type: 'text',
                    text: formatted
                }
            ]
        };

        this.currentMessages.push(userMessage); // This will be used for API serialization later
        this.shouldStop = false;

        try {
            const response = await this.sendChatRequest(effectiveSessionId);

            // If this was a new session, load the session info after sending the first message
            if (!effectiveSessionId && this.sessionManager) {
                await this.sessionManager.fetchSessions();
            } else if (effectiveSessionId && this.sessionManager) {
                // Update existing session to remove isLocal flag after successful reply
                await this.updateSessionAfterReply(effectiveSessionId);
            }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const aiMessageId = `ai_${Date.now()}`;

            // Ensure the response body is available
            if (!response.body) {
                throw new Error('Response body is null');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedData = '';

            const aiMessage: Message = {
                id: aiMessageId,
                role: 'assistant',
                created: Date.now(),
                content: [{ type: 'text', text: '' }]
            };

            this.currentMessages.push(aiMessage);
            // this.emit(ChatEvents.MESSAGE_RECEIVED, { ...aiMessage }); // Placeholder emission

            while (true) {
                if (this.shouldStop) {
                    logger.info("Stopping generation (shouldStop flag is true)");
                    reader.cancel();
                    this.emit(ChatEvents.FINISH, { ...aiMessage }, 'stopped');
                    break;
                }

                const { value, done } = await reader.read();

                if (done) {
                    logger.info("Stream complete, emitting FINISH event");
                    this.emit(ChatEvents.FINISH, { ...aiMessage }, 'complete');
                    break;
                }

                accumulatedData += decoder.decode(value, { stream: true });
                let newlineIndex;

                while ((newlineIndex = accumulatedData.indexOf('\n')) >= 0) {
                    const line = accumulatedData.substring(0, newlineIndex).trim();
                    accumulatedData = accumulatedData.substring(newlineIndex + 1);

                    if (line.startsWith('data:')) {
                        const jsonStr = line.substring(5).trim();
                        if (jsonStr === '[DONE]') {
                            continue;
                        }
                        if (jsonStr) {
                            try {
                                const eventData = JSON.parse(jsonStr) as MessageEvent;
                                if (eventData.type === 'Message' && eventData.message) {
                                    aiMessage.content = eventData.message.content;
                                    aiMessage.created = Date.now();
                                    this.emit(ChatEvents.MESSAGE_RECEIVED, { ...aiMessage });
                                } else if (eventData.type === 'Error') {
                                    logger.error(`ChatProcessor: Stream error event: ${eventData.error}`);
                                    this.emit(ChatEvents.ERROR, new Error(eventData.error));
                                }
                            } catch (e) {
                                logger.error('ChatProcessor: Failed to parse SSE JSON line:', e, 'Problematic JSON string:', jsonStr);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            this.shouldStop = true;
            this.emit(ChatEvents.ERROR, error);
            throw error;
        } finally {
            this.abortController = null;
        }
    }

    /**
     * Stop the current generation
     */
    public stopGeneration(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.shouldStop = true;

        if (this.currentMessages.length > 0) {
            const lastMessage = this.currentMessages[this.currentMessages.length - 1];
            if (lastMessage.role === 'assistant') {
                lastMessage.created = Date.now();
            }
        }

        this.emit(ChatEvents.FINISH, null, 'aborted');
    }

    /**
     * Get all current messages
     */
    public getMessages(): Message[] {
        return this.currentMessages;
    }

    /**
     * Clear all messages
     */
    public clearMessages(): void {
        this.currentMessages = [];
    }

    /**
     * Subscribe to chat events
     */
    public on(event: ChatEvents, listener: (...args: any[]) => void): void {
        this.eventEmitter.on(event, listener);
    }

    /**
     * Unsubscribe from chat events
     */
    public off(event: ChatEvents, listener: (...args: any[]) => void): void {
        this.eventEmitter.off(event, listener);
    }

    /**
     * Send a chat request to the server
     */
    private serializeMessagesForApi(messages: Message[]): Message[] {
        return messages.map(msg => {
            // Only modify user messages for now, as assistant messages are already in the expected format.
            // And system messages are not handled by this processor.
            if (msg.role !== 'user') {
                return msg;
            }

            const serializedContent: MessageContent[] = [];
            for (const part of msg.content) {
                if (part.type === 'code_context') {
                    const codeCtxPart = part as CodeContextPart;
                    let codeToSend = codeCtxPart.selectedText;
                    const lineCount = codeCtxPart.selectedText.split('\n').length;

                    if (lineCount > 100) {
                        // As per design: "truncated or replaced with a placeholder"
                        // Using a placeholder for clarity.
                        codeToSend = `[Code content >100 lines, see reference. Original selection was from ${codeCtxPart.fileName}:${codeCtxPart.startLine}-${codeCtxPart.endLine}]`;
                        logger.info(`ChatProcessor: CodeContextPart from ${codeCtxPart.filePath} has ${lineCount} lines. Truncating for API call.`);
                    }

                    const serializedText = `// Meta: FilePath="${codeCtxPart.filePath}", LanguageId="${codeCtxPart.languageId}", Lines=${codeCtxPart.startLine}-${codeCtxPart.endLine}\n\`\`\`${codeCtxPart.languageId || ''}\n${codeToSend}\n\`\`\``;
                    serializedContent.push({
                        type: 'text',
                        text: serializedText,
                    } as TextPart);
                } else {
                    // TextPart, ImageContent, Tool parts are passed as is
                    serializedContent.push(part);
                }
            }
            return { ...msg, content: serializedContent };
        });
    }

    private async sendChatRequest(sessionId?: string): Promise<Response> {
        this.abortController = new AbortController();

        const workspaceDirectory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

        const apiClient = this.serverManager.getApiClient();
        if (!apiClient) {
            throw new Error('API client not available');
        }

        const messagesForApi = this.serializeMessagesForApi(this.currentMessages);
        // Removed verbose logging of API messages

        const params = {
            prompt: messagesForApi, // Use serialized messages
            abortController: this.abortController,
            sessionId: sessionId,
            workspaceDirectory: workspaceDirectory,
        };

        return await apiClient.streamChatResponse(params);
    }

    private emit(event: ChatEvents, ...args: any[]): void {
        this.eventEmitter.emit(event, ...args);
    }



    private async updateSessionAfterReply(sessionId: string): Promise<void> {
        if (!this.sessionManager) {
            return;
        }

        try {
            const sessions = this.sessionManager.getSessions();

            const sessionIndex = sessions.findIndex(session => session.id === sessionId);

            if (sessionIndex !== -1 && sessions[sessionIndex].isLocal) {
                console.log(`Updating session ${sessionId} to remove isLocal flag after successful reply`);

                const updatedSession = { ...sessions[sessionIndex] };
                delete updatedSession.isLocal;

                const updatedSessions = [...sessions];
                updatedSessions[sessionIndex] = updatedSession;

                this.sessionManager.emitEvent(SessionEvents.SESSIONS_LOADED, updatedSessions);
            }
        } catch (error) {
            console.error('Error updating session after reply:', error);
        }
    }
}
