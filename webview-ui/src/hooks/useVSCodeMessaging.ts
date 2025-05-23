import { useState, useEffect, useCallback } from 'react';
import { getVSCodeAPI } from '../utils/vscode';
import { formatIntermediateContent } from '../utils/contentFormatters';

// Import MessageType from common types via alias
import { MessageType } from '@common-types/index';

// Use path alias for core shared types
import {
    Message,
    Role,
    TextPart, // Changed from TextContent
    MessageContent
} from '@shared/types/messages';

// Extend Message type to include system role and sessionId
interface ExtendedMessage extends Omit<Message, 'role' | 'content'> {
    role: Role | 'system';
    content: MessageContent[]; // This MessageContent is from @shared/types/messages
    sessionId?: string | null;
}

// Helper function to check if content is TextPart
function isTextContent(content: MessageContent): content is TextPart { // Changed to TextPart
    return content.type === 'text';
}

// Unused type, renamed with underscore prefix
type _MessageHandler = (message: any) => void;

// Interface for prepended code data (aligns with CodeReference from extension)
// This is what the payload of PREPARE_MESSAGE_WITH_CODE will be.
interface PrependedCodePayload {
    id: string;
    filePath: string;
    fileName: string;
    selectedText: string;
    languageId: string;
    startLine: number;
    endLine: number;
}

interface UseVSCodeMessagingResult {
    messages: ExtendedMessage[];
    serverStatus: string;
    isLoading: boolean;
    intermediateText: string | null;
    currentMessageId: string | null;
    codeReferences: any[]; // Using any for now, should import CodeReference type
    // Remove prependedCode state, handle via codeReferences
    // prependedCode: PrependedCode | null;
    // hasPrependedCode: boolean;
    sendChatMessage: (text: string, refs: any[], sessionId: string | null) => void;
    stopGeneration: () => void;
    restartServer: () => void;
    // Remove clearPrependedCode as it's no longer needed
    // clearPrependedCode: () => void;
    shikiTheme: string; // Added state for shiki theme
    extensionVersion: string; // Added for extension version
    resources: {
        gooseIcon?: string; // URI for the goose icon
    }; // Resources received from extension
}

// Define a type for the temporary reference used for prepended code,
// mirroring the CodeReference structure.
interface TemporaryPrependedRef {
    id: string;
    isPrepended: true; // Flag to identify this type
    filePath: string;
    fileName: string;
    selectedText: string;
    languageId: string;
    startLine: number;
    endLine: number;
}

export const useVSCodeMessaging = (): UseVSCodeMessagingResult => {
    const [messages, setMessages] = useState<ExtendedMessage[]>([]);
    const [serverStatus, setServerStatus] = useState<string>('stopped');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
    const [intermediateText, setIntermediateText] = useState<string | null>(null);
    // State now holds both regular CodeReferences and TemporaryPrependedRef
    const [codeReferences, setCodeReferences] = useState<(any | TemporaryPrependedRef)[]>([]); 
    // Remove prependedCode state
    // const [prependedCode, setPrependedCode] = useState<PrependedCode | null>(null);
    const [processedMessageIds, setProcessedMessageIds] = useState<Set<string>>(new Set());
    const [shikiTheme, setShikiTheme] = useState<string>('dark-plus'); // Default theme
    const [extensionVersion, setExtensionVersion] = useState<string>(''); // Extension version state
    const [resources, setResources] = useState<{ gooseIcon?: string }>({});

    // Remove derived state and clear function
    // const hasPrependedCode = prependedCode !== null;
    // const clearPrependedCode = useCallback(() => { ... }, [prependedCode]);

    const vscode = getVSCodeAPI();

    // Safely update messages state with error handling
    const safeguardedSetMessages = useCallback((updater: React.SetStateAction<ExtendedMessage[]>) => {
        try {
            setMessages(updater);
        } catch (err) {
            console.error('Error updating messages:', err);
        }
    }, []);

    // Send a hello message to the extension
    const sendHelloMessage = useCallback(() => {
        vscode.postMessage({
            command: MessageType.HELLO,
            text: 'Hello from the webview!'
        });
    }, [vscode]);

    // Send a chat message
    const sendChatMessage = useCallback((
        text: string,
        refs: any[],
        sessionId: string | null
    ) => {
        if (!text.trim() && refs.length === 0) {
            return;
        }

        // Check server status before sending
        if (serverStatus !== 'running') {
            const errorMessage: ExtendedMessage = {
                id: `error_${Date.now()}`,
                role: 'system',
                created: Date.now(),
                content: [{
                    type: 'text',
                    text: '❌ Cannot send message: Goose server is not connected. Please restart VS Code and try again.'
                }],
                sessionId: sessionId
            };
            safeguardedSetMessages(prev => [...prev, errorMessage]);
            return;
        }

        // Create a unique ID for this message
        const messageId = `user_${Date.now()}`;

        // Construct the content for the user message displayed in the UI
        // This content should be compatible with MessageContent from '@shared/types/messages'
        const uiMessageParts: import('@shared/types/messages').MessageContent[] = [];

        // Find if there's a temporary prepended reference in the state (from PREPARE_MESSAGE_WITH_CODE)
        const tempPrependedRefFromState = codeReferences.find(ref => ref.isPrepended === true) as TemporaryPrependedRef | undefined;

        if (tempPrependedRefFromState) {
            uiMessageParts.push({
                type: 'code_context',
                id: tempPrependedRefFromState.id,
                filePath: tempPrependedRefFromState.filePath,
                fileName: tempPrependedRefFromState.fileName,
                selectedText: tempPrependedRefFromState.selectedText,
                languageId: tempPrependedRefFromState.languageId,
                startLine: tempPrependedRefFromState.startLine,
                endLine: tempPrependedRefFromState.endLine,
            });
        }

        // Add code references (chips passed in 'refs' argument)
        // These are from ADD_CODE_REFERENCE, distinct from tempPrependedRefFromState
        if (refs && refs.length > 0) {
            for (const chipRef of refs) {
                // Ensure chipRef is not the same as tempPrependedRef if it somehow got included in 'refs'
                if (tempPrependedRefFromState && chipRef.id === tempPrependedRefFromState.id && (chipRef as any).isPrepended) {
                    continue; 
                }
                // Assuming chipRef is a CodeReference-like object
                uiMessageParts.push({
                    type: 'code_context',
                    id: chipRef.id,
                    filePath: chipRef.filePath,
                    fileName: chipRef.fileName,
                    selectedText: chipRef.selectedText, 
                    languageId: chipRef.languageId,
                    startLine: chipRef.startLine,
                    endLine: chipRef.endLine,
                });
            }
        }
        
        // Add the text content if it's not empty
        if (text.trim()) {
            uiMessageParts.push({
                type: 'text',
                text: text.trim(),
            });
        }
        
        const userMessage: ExtendedMessage = {
            id: messageId,
            role: 'user',
            created: Date.now(),
            content: uiMessageParts, // Directly use uiMessageParts
            sessionId: sessionId
        };

        // Update messages state with the new message
        safeguardedSetMessages(prevMessages => [...prevMessages, userMessage]);

        // Add the ID to processed set to prevent duplicates if we get it back from the extension
        setProcessedMessageIds(prev => new Set(prev).add(messageId));

        // Find if there's a temporary prepended reference in the state
        const tempPrependedRef = codeReferences.find(ref => ref.isPrepended === true) as TemporaryPrependedRef | undefined;
        
        // Filter out the temporary reference from the list sent to the backend as 'codeReferences'
        const actualCodeReferences = codeReferences.filter(ref => ref.isPrepended !== true);

        // Prepare message payload for the extension
        // Use 'let' so we can modify it
        let messagePayload: any = {
            command: MessageType.SEND_CHAT_MESSAGE,
            text: text,
            codeReferences: actualCodeReferences, // Send only actual references
            messageId: messageId,
            sessionId: sessionId
        };

        // If a temporary prepended reference exists, pass it as 'prependedCode'.
        // This tempPrependedRef should now be a full CodeReference-like object.
        if (tempPrependedRef) {
            // console.log('DEBUG: Found temporary prepended reference, adding it as prependedCode to payload.'); // Removed
            messagePayload.prependedCode = {
                id: tempPrependedRef.id,
                filePath: tempPrependedRef.filePath,
                fileName: tempPrependedRef.fileName,
                selectedText: tempPrependedRef.selectedText,
                languageId: tempPrependedRef.languageId,
                startLine: tempPrependedRef.startLine,
                endLine: tempPrependedRef.endLine,
            };
        } else {
             // console.log('DEBUG: No temporary prepended reference found.'); // Removed
        }

        // Send message to extension
        vscode.postMessage(messagePayload);

        setIsLoading(true);
        setCurrentMessageId(messageId);
        setIntermediateText(null); // Clear any previous intermediate text

        // Clear ALL code references (including the temporary one) from UI state after sending
        setCodeReferences([]); 
        
    }, [vscode, safeguardedSetMessages, serverStatus, codeReferences]); // Use codeReferences in dependency array

    // Stop AI generation
    const stopGeneration = useCallback(() => {
        vscode.postMessage({
            command: MessageType.STOP_GENERATION
        });
        setIsLoading(false);
    }, [vscode]);

    // Restart the server
    const restartServer = useCallback(() => {
        // console.log('Requesting server restart'); // Removed
        vscode.postMessage({
            command: MessageType.RESTART_SERVER
        });
        // We don't need to add a system message here since the status is already shown in the UI status pill
    }, [vscode]);

    // Set up event listener for VS Code extension messages
    useEffect(() => {
        // Initial setup
        sendHelloMessage();

        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (!message || !message.command) return;

            // console.log('Received message from extension:', message.command); // Removed

            switch (message.command) {
                case MessageType.CHAT_RESPONSE:
                    if (message.message) {
                        try {
                            // Process intermediate content (thinking or tool usage)
                            if (message.message.content && Array.isArray(message.message.content)) {
                                // if (process.env.NODE_ENV === 'development') { // Removed
                                    // console.debug('Processing message content:', // Removed
                                        // JSON.stringify(message.message.content.map((c: any) => ({ type: c.type }))) // Removed
                                    // ); // Removed
                                // } // Removed

                                // Look for thinking content first
                                const thinkingContent = message.message.content.find(
                                    (item: any) => item.type === 'thinking' || item.type === 'redacted_thinking'
                                );

                                if (thinkingContent && 'thinking' in thinkingContent) {
                                    setIntermediateText(thinkingContent.thinking);

                                    // if (process.env.NODE_ENV === 'development') { // Removed
                                        // console.debug('Updated intermediate text from thinking:', thinkingContent.thinking); // Removed
                                    // } // Removed

                                    return; // Don't add thinking messages to the main message list
                                }

                                // If no thinking content, check for tool requests
                                const toolRequestContent = message.message.content.find(
                                    (item: any) => item.type === 'toolRequest'
                                );

                                if (toolRequestContent) {
                                    const formattedText = formatIntermediateContent(toolRequestContent);
                                    setIntermediateText(formattedText);

                                    // if (process.env.NODE_ENV === 'development') { // Removed
                                        // console.debug('Updated intermediate text from tool request:', formattedText); // Removed
                                    // } // Removed

                                    return; // Don't add tool request messages to the main message list
                                }
                            }
                        } catch (error) {
                            console.error('Error processing message content:', error);

                            // Fallback behavior - show generic message
                            setIntermediateText('Processing your request...');
                        }

                        // Get a content summary for comparison
                        const getContentSummary = (msg: ExtendedMessage) => {
                            if (!msg.content || !Array.isArray(msg.content)) return '';
                            return msg.content.map(item => {
                                if (isTextContent(item)) return item.text || '';
                                return '';
                            }).join('|');
                        };

                        const newContentSummary = getContentSummary(message.message);

                        // Check if we have an existing message with the same ID
                        if (message.message.id && processedMessageIds.has(message.message.id)) {
                            // If content is actually different, update the existing message
                            const existingMsgIndex = messages.findIndex(m => m.id === message.message.id);

                            if (existingMsgIndex !== -1) {
                                const existingContentSummary = getContentSummary(messages[existingMsgIndex]);

                                // Only update if the content has changed
                                if (newContentSummary !== existingContentSummary) {
                                    // console.log('Updating existing message with new content:', message.message.id); // Removed

                                    safeguardedSetMessages(prev => {
                                        const updated = [...prev];
                                        updated[existingMsgIndex] = message.message;
                                        return updated;
                                    });
                                } else {
                                    // console.log('Content unchanged, skipping update'); // Removed
                                }
                            }
                            return;
                        }

                        // Filter out empty text messages to prevent duplicate "Generating content..." messages
                        if (message.message.content && Array.isArray(message.message.content)) {
                            const hasEmptyTextOnly = message.message.content.every(
                                (item: any) => item.type === 'text' && (!item.text || item.text.trim() === '')
                            );

                            if (hasEmptyTextOnly && message.message.content.length > 0) {
                                // console.log('Skipping empty text message'); // Removed
                                return;
                            }
                        }

                        // Add the message ID to processed set
                        if (message.message.id) {
                            setProcessedMessageIds(prev => {
                                const newSet = new Set(prev);
                                newSet.add(message.message.id);
                                return newSet;
                            });
                        }

                        // Now add the message to the state
                        safeguardedSetMessages(prev => [...prev, message.message]);
                    }
                    break;
                case MessageType.AI_MESSAGE:
                    // Sometimes we receive partial content through AI_MESSAGE type
                    if (message.content && typeof message.content === 'string') {
                        // This is likely thinking/intermediate content
                        setIntermediateText(message.content);
                    }
                    break;
                case MessageType.GENERATION_FINISHED:
                    // console.log('Generation finished event received'); // Removed
                    // Explicitly clear loading state and intermediate text
                    setIsLoading(false);
                    setIntermediateText(null);
                    setCurrentMessageId(null);
                    break;
                case MessageType.SERVER_STATUS:
                    if (message.status) {
                        // console.log('Updating server status:', message.status); // Removed

                        // Check if server is transitioning from stopped/error to running
                        const wasDown = serverStatus === 'stopped' || serverStatus === 'error';
                        const isNowRunning = message.status === 'running';

                        // Update the server status first
                        setServerStatus(message.status);

                        // Show server back up message if appropriate
                        // if (wasDown && isNowRunning) { // REMOVED: System message for server connection
                        //     const serverUpMessage: ExtendedMessage = {
                        //         id: `server_up_${Date.now()}`,
                        //         role: 'system',
                        //         created: Date.now(),
                        //         content: [{
                        //             type: 'text',
                        //             text: 'Goose server is now connected and ready.'
                        //         }]
                        //     };
                        //     safeguardedSetMessages(prev => [...prev, serverUpMessage]);
                        // }
                    }
                    break;
                case MessageType.SERVER_EXIT:
                    // console.log('Server process exited with code:', message.code); // Removed
                    setServerStatus('stopped');
                    // We'll let the GeneratingIndicator component in MessageList handle the display
                    // of the server exit status, so we don't need to create a separate message
                    break;
                case MessageType.ERROR:
                    if (message.errorMessage) {
                        console.error('Error from extension:', message.errorMessage);
                        // console.log('Connection error detected, updating server status to stopped'); // Kept console.error, removed this log
                        setServerStatus('stopped');
                        // We're now handling error display through the GeneratingIndicator component
                        // so we don't need to create a separate error message
                    }
                    break;
                case MessageType.PREPARE_MESSAGE_WITH_CODE:
                    if (message.payload) {
                        const payload = message.payload as PrependedCodePayload; // Cast payload
                        // console.log('Received PREPARE_MESSAGE_WITH_CODE, creating temporary reference:', payload.fileName); // Removed
                        // Create a temporary reference object and add it to the codeReferences state
                        // Ensure this uses selectedText and other CodeReference fields from the payload
                        const tempRef: TemporaryPrependedRef = {
                            id: payload.id || `prepended_${Date.now()}`, // Use ID from payload or generate
                            isPrepended: true,
                            filePath: payload.filePath,
                            fileName: payload.fileName,
                            selectedText: payload.selectedText, // Use selectedText from payload
                            languageId: payload.languageId,
                            startLine: payload.startLine,
                            endLine: payload.endLine
                        };
                        // Replace existing references/prepended code with this new one
                        setCodeReferences([tempRef]);
                    }
                    break;
                case MessageType.ADD_CODE_REFERENCE:
                    if (message.codeReference) {
                        // console.log('Adding code reference from selection:', message.codeReference.fileName); // Removed
                        // Ensure no temporary prepended ref exists when adding a real one
                        setCodeReferences(prev => [...prev.filter(ref => ref.isPrepended !== true), message.codeReference]);
                    }
                    break;
                case MessageType.CODE_REFERENCE:
                    if (message.reference) {
                        setCodeReferences(prev => [...prev, message.reference]);
                    }
                    break;
                case MessageType.REMOVE_CODE_REFERENCE:
                    if (message.id) {
                        // console.log('Removing code reference:', message.id); // Removed
                        setCodeReferences(prev => prev.filter(ref => ref.id !== message.id));
                    }
                    break;
                case MessageType.SESSION_LOADED:
                    // console.log('Session loaded with ID:', message.sessionId); // Removed
                    
                    // Clear any prepended code/references when switching sessions
                    setCodeReferences([]); 
                    setCurrentMessageId(null);
                    setIntermediateText(null);
                    setIsLoading(false);

                    // Simple approach - just clear messages first
                    setMessages([]);

                    // Check if we have messages to display
                    if (!message.messages || !Array.isArray(message.messages) || message.messages.length === 0) {
                        // console.log('No messages in session'); // Removed
                        break;
                    }

                    // We'll defer loading the messages to prevent React errors
                    setTimeout(() => {
                        try {
                            // Very basic message transformation - just ensure required fields exist
                            const validMessages = message.messages
                                .filter((msg: any) => msg && typeof msg === 'object')
                                .map((msg: any) => ({
                                    id: msg.id || `msg_${Math.random().toString(36).substr(2, 9)}`,
                                    role: msg.role || 'unknown',
                                    created: msg.created || Date.now(),
                                    content: Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: 'Message content unavailable' }],
                                    sessionId: msg.sessionId
                                }));

                            // console.log(`Loading ${validMessages.length} messages`); // Removed
                            setMessages(validMessages);
                        } catch (err) {
                            console.error('Error processing messages:', err);
                        }
                    }, 100); // Slight delay to ensure React has time to process state changes
                    break;
                case MessageType.SET_THEME:
                    if (message.theme && typeof message.theme === 'string') {
                        // console.log('Setting shiki theme:', message.theme); // Removed
                        setShikiTheme(message.theme);
                    }
                    break;
                case MessageType.SET_EXTENSION_VERSION:
                    if (message.version && typeof message.version === 'string') {
                        // console.log('Received extension version:', message.version); // Removed
                        setExtensionVersion(message.version);
                    }
                    break;
                case MessageType.RESOURCES_READY:
                    if (message.resources && typeof message.resources === 'object') {
                        // console.log('Received resources from extension:', message.resources); // Removed
                        setResources(message.resources);
                    }
                    break;
                // Add cases for messages handled by other hooks to prevent "Unknown message type" logs
                case MessageType.SESSIONS_LIST:
                case MessageType.SESSION_LOADED:
                    // These are handled by useSessionManagement, so we can ignore them here.
                    // console.debug(`[useVSCodeMessaging] Ignoring message type ${message.command}, handled elsewhere.`);
                    break;
                default:
                    // Handle unknown message types
                    console.warn('[useVSCodeMessaging] Unknown message type:', message.command, message);
            }
        };

        window.addEventListener('message', handleMessage);

        // Set up a timer to periodically refresh the context and check server status
        const timer = setInterval(() => {
            vscode.postMessage({
                command: MessageType.GET_SERVER_STATUS
            });
        }, 30000); // Every 30 seconds

        // Clean up event listener and timer
        return () => {
            window.removeEventListener('message', handleMessage);
            clearInterval(timer);
        };
    }, [
        sendHelloMessage,
        processedMessageIds,
        safeguardedSetMessages,
        serverStatus,
        messages
    ]);

    // Effect to re-fetch server status when webview becomes visible
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                // console.log('[useVSCodeMessaging] Webview became visible, requesting server status.');
                vscode.postMessage({ command: MessageType.GET_SERVER_STATUS });
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        // The initial server status is already sent by the extension
        // in response to WEBVIEW_READY. This listener is specifically for
        // when the tab visibility changes *after* initial load.

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [vscode]); // vscode is stable, so this effect runs once on mount to set up the listener

    return {
        messages,
        serverStatus,
        isLoading,
        intermediateText,
        currentMessageId,
        codeReferences,
        // Remove prependedCode related exports
        // prependedCode,
        // hasPrependedCode,
        sendChatMessage,
        stopGeneration,
        restartServer,
        // clearPrependedCode
        shikiTheme, // Export the theme state
        extensionVersion, // Export the extension version
        resources // Export the resources
    };
};
