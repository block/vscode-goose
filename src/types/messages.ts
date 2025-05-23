/**
 * Message types that match the Rust message structures
 * for direct serialization between client and server
 */

import { CodeReference } from '../utils/codeReferenceManager';

export type Role = 'user' | 'assistant';

/**
 * Represents a plain text segment, potentially containing user-typed markdown.
 */
export interface TextPart {
    type: 'text';
    text: string;
    annotations?: Record<string, unknown>;
}

/**
 * Represents a snippet of code context, directly using or extending CodeReference.
 * This part is intended for structured data transfer and specific UI rendering.
 */
export interface CodeContextPart extends CodeReference {
    type: 'code_context';
    // id, filePath, fileName, startLine, endLine, selectedText, languageId are inherited from CodeReference.
}

export interface ImageContent {
    type: 'image';
    data: string;
    mimeType: string;
    annotations?: Record<string, unknown>;
}

export type Content = TextPart | CodeContextPart | ImageContent; // Updated to include CodeContextPart

export interface ToolCall {
    name: string;
    arguments: Record<string, unknown>;
}

export interface ToolCallResult<T> {
    status: 'success' | 'error';
    value?: T;
    error?: string;
}

export interface ToolRequest {
    id: string;
    toolCall: ToolCallResult<ToolCall>;
}

export interface ToolResponse {
    id: string;
    toolResult: ToolCallResult<MessageContent[]>; // Changed Content[] to MessageContent[]
}

export interface ToolConfirmationRequest {
    id: string;
    toolName: string;
    arguments: Record<string, unknown>;
    prompt?: string;
}

export interface ToolRequestMessageContent {
    type: 'toolRequest';
    id: string;
    toolCall: ToolCallResult<ToolCall>;
}

export interface ToolResponseMessageContent {
    type: 'toolResponse';
    id: string;
    toolResult: ToolCallResult<MessageContent[]>; // Changed Content[] to MessageContent[]
}

export interface ToolConfirmationRequestMessageContent {
    type: 'toolConfirmationRequest';
    id: string;
    toolName: string;
    arguments: Record<string, unknown>;
    prompt?: string;
}

export type MessageContent =
    | TextPart // Changed from TextContent
    | CodeContextPart // Added
    | ImageContent
    | ToolRequestMessageContent
    | ToolResponseMessageContent
    | ToolConfirmationRequestMessageContent;

export interface Message {
    id?: string;
    role: Role;
    created: number;
    content: MessageContent[];
}

// Helper functions to create messages
export function createUserMessage(text: string): Message {
    return {
        id: generateId(),
        role: 'user',
        created: Math.floor(Date.now() / 1000),
        content: [{ type: 'text', text } as TextPart], // Cast to TextPart
    };
}

export function createAssistantMessage(text: string): Message {
    return {
        id: generateId(),
        role: 'assistant',
        created: Math.floor(Date.now() / 1000),
        content: [{ type: 'text', text } as TextPart], // Cast to TextPart
    };
}

export function createToolRequestMessage(
    id: string,
    toolName: string,
    args: Record<string, unknown>
): Message {
    return {
        id: generateId(),
        role: 'assistant',
        created: Math.floor(Date.now() / 1000),
        content: [
            {
                type: 'toolRequest',
                id,
                toolCall: {
                    status: 'success',
                    value: {
                        name: toolName,
                        arguments: args,
                    },
                },
            },
        ],
    };
}

export function createToolResponseMessage(id: string, result: MessageContent[]): Message { // Changed Content[] to MessageContent[]
    return {
        id: generateId(),
        role: 'user',
        created: Math.floor(Date.now() / 1000),
        content: [
            {
                type: 'toolResponse',
                id,
                toolResult: {
                    status: 'success',
                    value: result,
                },
            },
        ],
    };
}

export function createToolErrorResponseMessage(id: string, error: string): Message {
    return {
        id: generateId(),
        role: 'user',
        created: Math.floor(Date.now() / 1000),
        content: [
            {
                type: 'toolResponse',
                id,
                toolResult: {
                    status: 'error',
                    error,
                },
            },
        ],
    };
}

// Generate a unique ID for messages
function generateId(): string {
    return Math.random().toString(36).substring(2, 10);
}

// Helper functions to extract content from messages
export function getTextContent(message: Message): string {
    return message.content
        .filter((content): content is TextPart => content.type === 'text') // Changed TextContent to TextPart
        .map((content) => content.text)
        .join('\n');
}

export function getToolRequests(message: Message): ToolRequestMessageContent[] {
    return message.content.filter(
        (content): content is ToolRequestMessageContent => content.type === 'toolRequest'
    );
}

export function getToolResponses(message: Message): ToolResponseMessageContent[] {
    return message.content.filter(
        (content): content is ToolResponseMessageContent => content.type === 'toolResponse'
    );
}

export function getToolConfirmationContent(
    message: Message
): ToolConfirmationRequestMessageContent | undefined {
    return message.content.find(
        (content): content is ToolConfirmationRequestMessageContent =>
            content.type === 'toolConfirmationRequest'
    );
}

export function hasCompletedToolCalls(message: Message): boolean {
    const toolRequests = getToolRequests(message);
    if (toolRequests.length === 0) {return false;}

    // For now, we'll assume all tool calls are completed when this is checked
    // In a real implementation, you'd need to check if all tool requests have responses
    // by looking through subsequent messages
    return true;
}
