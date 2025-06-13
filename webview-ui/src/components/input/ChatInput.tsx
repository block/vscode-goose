import React, { useRef, useEffect, useState } from 'react';
import { CodeReferences } from '../codeReferences/CodeReferences';
import { CodeReference } from '../../types/index';
import './ChatInput.css';
// Import Lucide icons for send/stop
import {  SendHorizonal, StopCircle } from 'lucide-react'; 

// Interface for prepended code data
interface PrependedCode {
    content: string;
    fileName: string;
    languageId: string;
    startLine: number; 
    endLine: number;   
}

// Remove props related to the old prepended code banner
interface ChatInputProps {
    inputMessage: string;
    codeReferences: CodeReference[]; // This will now include temporary prepended refs
    isLoading: boolean;
    // prependedCode: PrependedCode | null; 
    // hasPrependedCode: boolean; 
    onInputChange: (value: string) => void;
    onSendMessage: () => void;
    onStopGeneration: () => void;
    onRemoveCodeReference: (id: string) => void; // Handles removing both real and temp refs
    // onClearPrependedCode: () => void; 
}

export const ChatInput: React.FC<ChatInputProps> = ({
    inputMessage,
    codeReferences, // Note: codeReferences are not directly used for button disabled state anymore
    isLoading,
    // Remove unused props
    // prependedCode, 
    // hasPrependedCode, 
    onInputChange,
    onSendMessage,
    onStopGeneration,
    onRemoveCodeReference, // This function now handles removing the temporary chip too
    // onClearPrependedCode 
}) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [wasLoading, setWasLoading] = useState(false);

    // Track focus state of the webview
    const [isWebviewFocused, setIsWebviewFocused] = useState(true);

    const isInputTextEmpty = inputMessage.trim() === '';

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isLoading && !isInputTextEmpty) { // Send if not loading and text is not empty
                onSendMessage();
            }
        }
    };

    // Set up focus and blur event listeners for the window
    useEffect(() => {
        const handleFocus = () => setIsWebviewFocused(true);
        const handleBlur = () => setIsWebviewFocused(false);

        window.addEventListener('focus', handleFocus);
        window.addEventListener('blur', handleBlur);

        // Capture initial focus state
        setIsWebviewFocused(document.hasFocus());

        return () => {
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    // Focus the textarea when isLoading changes from true to false
    // but only if webview still has focus
    useEffect(() => {
        // Track when loading state changes
        if (isLoading !== wasLoading) {
            setWasLoading(isLoading);

            // Focus input only when loading ends AND the webview still has focus
            if (wasLoading && !isLoading && isWebviewFocused && textareaRef.current) {
                // Small delay to ensure UI has updated
                setTimeout(() => {
                    if (document.hasFocus() && textareaRef.current) {
                        textareaRef.current.focus();
                    }
                }, 10);
            }
        }
    }, [isLoading, wasLoading, isWebviewFocused]);

    // If loading, button is for stopping and should NOT be disabled by text check.
    // Otherwise, it's a send button, disabled if input text is empty.
    const sendButtonDisabled = isLoading ? false : isInputTextEmpty;

    let buttonTitle: string;
    if (isLoading) {
        buttonTitle = 'Stop generation';
    } else if (isInputTextEmpty) {
        buttonTitle = 'Type a message to send'; // Updated title for empty text input
    } else {
        buttonTitle = 'Send message (Enter)';
    }

    return (
        <div className="input-container">
            {/* Show code references */}
            <CodeReferences
                codeReferences={codeReferences}
                onRemoveReference={onRemoveCodeReference} // Pass the remove handler
            />
            
            {/* Remove the old prepended code indicator banner */}

            <div className="input-row">
                <textarea
                    ref={textareaRef}
                    value={inputMessage}
                    onChange={(e) => onInputChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={"What can Goose help with?"} // Update placeholder text
                    disabled={isLoading}
                    // Remove conditional class based on hasPrependedCode
                    // className={hasPrependedCode ? 'has-prepended-code' : ''} 
                />

                {/* Apply the working 'icon-button' class */}
                <button
                    className="icon-button" 
                    onClick={isLoading ? onStopGeneration : onSendMessage}
                    disabled={sendButtonDisabled}
                    title={buttonTitle} 
                >
                    {/* Use Lucide SVG icons */}
                    {isLoading ? <StopCircle size={16} /> : <SendHorizonal size={16} />}
                </button>
            </div>
        </div>
    );
};
