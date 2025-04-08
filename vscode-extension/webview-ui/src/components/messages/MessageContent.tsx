import React, { useState } from 'react';
import { MessageContent as MessageContentType } from '../../types/index';
import { useVSCodeMessaging } from '../../hooks/useVSCodeMessaging';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import './MessageContent.css';

interface MessageContentProps {
    content: MessageContentType[];
}

export const MessageContentRenderer: React.FC<MessageContentProps> = ({ content }) => {
    // State to track which code block has been copied
    const [copiedCodeBlock, setCopiedCodeBlock] = useState<string | null>(null);

    // Get the messaging hooks for actions
    const { restartServer, serverStatus } = useVSCodeMessaging();

    // Handle action button clicks
    const handleAction = (action: string) => {
        console.log('Action clicked:', action);
        switch (action) {
            case 'restart-server':
                restartServer();
                break;
            default:
                console.warn('Unknown action:', action);
        }
    };

    // Handle copying code to clipboard
    const handleCopyCode = (code: string, blockId: string) => {
        navigator.clipboard.writeText(code).then(() => {
            setCopiedCodeBlock(blockId);
            // Reset after animation completes
            setTimeout(() => setCopiedCodeBlock(null), 600);
        }).catch(err => {
            console.error('Failed to copy code:', err);
        });
    };

    // Check if the server is in a state where restart shouldn't be enabled
    const isServerBusy = serverStatus === 'starting' || serverStatus === 'running';

    // If content array is empty or null/undefined, show a placeholder
    if (!content || content.length === 0) {
        return (
            <div className="message-text empty-message">
                <i>Empty response. Waiting for content...</i>
            </div>
        );
    }

    // Create a filtered array of valid content items
    const validItems = content.filter(item => {
        // First check if item exists
        if (!item) {
            return false;
        }

        // Check if it's a text item (most common)
        if (item.type === 'text') {
            // Allow even empty strings during generation
            return typeof item.text === 'string';
        }

        // Other content types might be valid, keep them
        return true;
    });

    // If we have no valid items after filtering, show the fallback
    if (validItems.length === 0) {
        return (
            <div className="message-text empty-message">
                <i>Waiting for response content...</i>
            </div>
        );
    }

    // Map valid content items to components
    return (
        <>
            {validItems.map((item, index) => {
                if (item.type === 'text') {
                    // If the text is empty, show generating message
                    if (!item.text || item.text.trim() === '') {
                        return (
                            <div key={index} className="message-text empty-message">
                                <i>Generating content...</i>
                            </div>
                        );
                    }

                    // Check if the content appears to be JSON data that needs parsing
                    let textContent = item.text;
                    if (typeof textContent === 'string' && textContent.trim().startsWith('data:')) {
                        try {
                            // Extract the JSON part
                            const jsonMatch = textContent.match(/data:\s*(\{.*\})/);
                            if (jsonMatch && jsonMatch[1]) {
                                const jsonData = JSON.parse(jsonMatch[1]);
                                if (jsonData.message && typeof jsonData.message === 'string') {
                                    textContent = jsonData.message;
                                }
                            }
                        } catch (e) {
                            console.error('Error parsing JSON in message:', e);
                        }
                    }

                    return (
                        <div key={index} className="message-text">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    code({ className, children, ...props }) {
                                        // Check if this is a code block (has language class)
                                        const match = /language-(\w+)/.exec(className || '');
                                        const isCodeBlock = !!match;
                                        const codeContent = String(children).replace(/\n$/, '');

                                        // Create unique id for this code block
                                        const blockId = `code-block-${index}-${match ? match[1] : 'text'}-${codeContent.length}`;
                                        const isCopied = copiedCodeBlock === blockId;

                                        if (isCodeBlock) {
                                            return (
                                                <div className="code-block-wrapper">
                                                    <div className="code-block-header">
                                                        {match && match[1] && (
                                                            <span className="code-block-language">
                                                                {match[1]}
                                                            </span>
                                                        )}
                                                        <button
                                                            className={`code-block-copy ${isCopied ? 'copied' : ''}`}
                                                            onClick={() => handleCopyCode(codeContent, blockId)}
                                                            title="Copy code"
                                                        >
                                                            <i className={`codicon ${isCopied ? 'codicon-check' : 'codicon-copy'}`}></i>
                                                        </button>
                                                    </div>
                                                    <SyntaxHighlighter
                                                        language={match ? match[1] : ''}
                                                        style={vscDarkPlus}
                                                        PreTag="div"
                                                        className="code-block-content"
                                                    >
                                                        {codeContent}
                                                    </SyntaxHighlighter>
                                                </div>
                                            );
                                        }

                                        return (
                                            <code className={className} {...props}>
                                                {children}
                                            </code>
                                        );
                                    }
                                }}
                            >
                                {textContent}
                            </ReactMarkdown>
                        </div>
                    );
                } else if (item.type === 'image' && 'url' in item) {
                    return (
                        <div key={index} className="message-image">
                            <img src={item.url} alt="Generated" />
                        </div>
                    );
                } else if (item.type === 'action' && 'action' in item) {
                    // If action is for restarting server, show appropriate status
                    const isRestartAction = item.action === 'restart-server';

                    // If server is running, don't show the restart button at all
                    if (isRestartAction && serverStatus === 'running') {
                        return (
                            <div key={index} className="message-action">
                                <div className="server-status-message">
                                    <span className="status-icon"><i className="codicon codicon-check"></i></span>
                                    Server is now running
                                </div>
                            </div>
                        );
                    }

                    // If server is starting, show a message indicating it's starting
                    if (isRestartAction && serverStatus === 'starting') {
                        return (
                            <div key={index} className="message-action">
                                <div className="server-status-message">
                                    <span className="status-icon"><i className="codicon codicon-loading codicon-modifier-spin"></i></span>
                                    Server is starting...
                                </div>
                            </div>
                        );
                    }

                    return (
                        <div key={index} className="message-action">
                            <button
                                className="action-button"
                                onClick={() => handleAction(item.action)}
                                title={item.label}
                            >
                                {isRestartAction ? 'Restart Server' : item.label}
                            </button>
                        </div>
                    );
                }
                return null;
            })}
        </>
    );
}; 
