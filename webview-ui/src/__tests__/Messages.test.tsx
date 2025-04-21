import { vi, describe, it, expect, beforeEach as _beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Message, MessageType as _MessageType, TextContent } from '../test/mocks/types';
import Messages from '../components/Messages';
import { MessageContentWrapper } from '../components/Messages/MessageContentWrapper';
import { CodeReference } from '../test/mocks/types';

// Mock the scrollIntoView function
Element.prototype.scrollIntoView = vi.fn();

describe('Messages Component', () => {
    describe('Message Rendering', () => {
        it('renders a user message with text content', () => {
            const userMessage: Message = {
                id: 'user-123',
                role: 'user',
                created: Date.now(),
                content: [{
                    type: 'text',
                    text: 'How do I implement a React component?'
                }] as TextContent[]
            };

            render(
                <div className="message-container">
                    <div className="message-header">
                        <div className="message-role">You</div>
                        <div className="message-time">12:34</div>
                    </div>
                    <div className="message user">
                        <div className="message-content">
                            <div className="message-text">
                                {userMessage.content[0].text}
                            </div>
                        </div>
                    </div>
                </div>
            );

            expect(screen.getByText('You')).toBeInTheDocument();
            expect(screen.getByText('How do I implement a React component?')).toBeInTheDocument();
        });

        it('renders an assistant message with text content', () => {
            const assistantMessage: Message = {
                id: 'assistant-123',
                role: 'assistant',
                created: Date.now(),
                content: [{
                    type: 'text',
                    text: 'Here\'s how to create a React component...'
                }] as TextContent[]
            };

            render(
                <div className="message-container">
                    <div className="message-header">
                        <div className="message-role">Goose</div>
                        <div className="message-time">12:35</div>
                    </div>
                    <div className="message ai">
                        <div className="message-content">
                            <div className="message-text markdown">
                                {assistantMessage.content[0].text}
                            </div>
                        </div>
                    </div>
                </div>
            );

            expect(screen.getByText('Goose')).toBeInTheDocument();
            expect(screen.getByText('Here\'s how to create a React component...')).toBeInTheDocument();
        });

        it('renders code block content within a message', () => {
            const markdownWithCode = `
Here's a simple React component:

\`\`\`jsx
import React from 'react';

function MyComponent() {
  return <div>Hello World</div>;
}

export default MyComponent;
\`\`\`
      `;

            render(
                <div className="message-container">
                    <div className="message-header">
                        <div className="message-role">Goose</div>
                        <div className="message-time">12:36</div>
                    </div>
                    <div className="message ai">
                        <div className="message-content">
                            <div className="message-text markdown">
                                {markdownWithCode}
                            </div>
                        </div>
                    </div>
                </div>
            );

            expect(screen.getByText(/Here's a simple React component/)).toBeInTheDocument();
            expect(screen.getByText(/import React from 'react'/)).toBeInTheDocument();
            expect(screen.getByText(/function MyComponent/)).toBeInTheDocument();
        });
    });

    describe('Message Display', () => {
        it('renders message with header showing role and time', () => {
            const now = Date.now();
            const time = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            render(
                <div className="message-container">
                    <div className="message-header">
                        <div className="message-role">You</div>
                        <div className="message-time">{time}</div>
                    </div>
                    <div className="message user">
                        <div className="message-content">
                            <div className="message-text">Hello Goose!</div>
                        </div>
                    </div>
                </div>
            );

            expect(screen.getByText('You')).toBeInTheDocument();
            expect(screen.getByText('Hello Goose!')).toBeInTheDocument();
            expect(screen.getByText(time)).toBeInTheDocument();
        });

        it('renders multiple messages in a conversation flow', () => {
            render(
                <div className="message-list">
                    {/* User message */}
                    <div className="message-container">
                        <div className="message-header">
                            <div className="message-role">You</div>
                            <div className="message-time">12:30</div>
                        </div>
                        <div className="message user">
                            <div className="message-content">
                                <div className="message-text">What is React?</div>
                            </div>
                        </div>
                    </div>

                    {/* AI response */}
                    <div className="message-container">
                        <div className="message-header">
                            <div className="message-role">Goose</div>
                            <div className="message-time">12:31</div>
                        </div>
                        <div className="message ai">
                            <div className="message-content">
                                <div className="message-text">React is a JavaScript library for building user interfaces.</div>
                            </div>
                        </div>
                    </div>

                    {/* Follow-up user message */}
                    <div className="message-container">
                        <div className="message-header">
                            <div className="message-role">You</div>
                            <div className="message-time">12:32</div>
                        </div>
                        <div className="message user">
                            <div className="message-content">
                                <div className="message-text">How do I install it?</div>
                            </div>
                        </div>
                    </div>
                </div>
            );

            expect(screen.getByText('What is React?')).toBeInTheDocument();
            expect(screen.getByText('React is a JavaScript library for building user interfaces.')).toBeInTheDocument();
            expect(screen.getByText('How do I install it?')).toBeInTheDocument();
        });
    });

    describe('Message Formatting', () => {
        it('renders markdown formatting in messages', () => {
            const markdownText = `
# Heading
**Bold text**
*Italic text*
- List item 1
- List item 2
      `;

            render(
                <div className="message-container">
                    <div className="message-header">
                        <div className="message-role">Goose</div>
                        <div className="message-time">12:40</div>
                    </div>
                    <div className="message ai">
                        <div className="message-content">
                            <div className="message-text markdown">
                                {markdownText}
                            </div>
                        </div>
                    </div>
                </div>
            );

            expect(screen.getByText(/Heading/)).toBeInTheDocument();
            expect(screen.getByText(/Bold text/)).toBeInTheDocument();
            expect(screen.getByText(/Italic text/)).toBeInTheDocument();
            expect(screen.getByText(/List item 1/)).toBeInTheDocument();
            expect(screen.getByText(/List item 2/)).toBeInTheDocument();
        });
    });

    describe('Empty and Loading States', () => {
        it('renders empty state when no messages', () => {
            render(
                <div className="message-list empty-message-list">
                    <div className="empty-state">
                        <h2>Ask me something about your code</h2>
                        <p>I'll help you understand your codebase, write tests, fix bugs, and more.</p>
                    </div>
                </div>
            );

            expect(screen.getByText('Ask me something about your code')).toBeInTheDocument();
            expect(screen.getByText('I\'ll help you understand your codebase, write tests, fix bugs, and more.')).toBeInTheDocument();
        });

        it('renders loading state during message generation', () => {
            render(
                <div className="generating-container">
                    <div className="generating-indicator">
                        <div className="dot-pulse"></div>
                        <span>Generating...</span>
                        <button className="stop-generation-button">Stop</button>
                    </div>
                </div>
            );

            expect(screen.getByText('Generating...')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
        });
    });
}); 
