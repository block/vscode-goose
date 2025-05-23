import React, { RefObject } from 'react'; // Import RefObject
import { SessionMetadata } from './SessionList';
// Import Lucide icons
import { History, Plus, Settings } from 'lucide-react'; // Added Settings icon

interface HeaderProps {
    status: string;
    currentSession: SessionMetadata | null; // Keep currentSession prop if needed elsewhere, otherwise remove if unused
    onToggleSessionDrawer: () => void;
    isGenerating: boolean;
    onNewSession: () => void;
    onOpenSettings: () => void; // Add handler for opening settings
    toggleButtonRef: RefObject<HTMLButtonElement>; // Add ref prop for the toggle button
}

export const Header: React.FC<HeaderProps> = ({
    status,
    onToggleSessionDrawer,
    isGenerating,
    onNewSession,
    onOpenSettings, // Destructure the settings handler
    toggleButtonRef // Destructure the ref prop
}) => {
    // Helper to get status display text (incorporating isGenerating)
    const getDisplayStatus = (status: string, isGenerating: boolean): string => {
        if (isGenerating) return 'GENERATING';
        if (status === 'running') return 'SERVER CONNECTED';
        // Add other status mappings as needed (e.g., error details)
        return status.toUpperCase();
    };

    // Helper to get status color theme variable
    const getStatusColorVar = (status: string, isGenerating: boolean): string => {
        if (isGenerating) return 'var(--vscode-gitDecoration-modifiedResourceForeground)'; // Blue for Generating

        // Convert status to lowercase for consistent comparison
        const statusLower = status.toLowerCase();

        switch (statusLower) {
            case 'running':
                return 'var(--vscode-testing-iconPassed)'; // Green for running
            case 'error':
            case 'stopped':
                return 'var(--vscode-errorForeground)'; // Red
            case 'connecting':
            case 'initializing':
                return 'var(--vscode-debugIcon-pauseForeground)'; // Yellow/Orange
            default:
                return 'var(--vscode-disabledForeground)'; // Gray
        }
    };

    const displayStatus = getDisplayStatus(status, isGenerating);
    const statusColorVar = getStatusColorVar(status, isGenerating);

    return (
        <div className="vscode-chat-header">
            <div className="header-actions">
                {/* New Session Button */}
                <button
                    className="icon-button"
                    title="New Session"
                    onClick={onNewSession}
                    disabled={isGenerating}
                >
                    <Plus size={16} /> {/* Use Lucide Plus icon */}
                </button>

                {/* Session History Button - Assign the ref here */}
                <button
                    ref={toggleButtonRef} // Assign the ref
                    className="icon-button"
                    title="Session History"
                    onClick={onToggleSessionDrawer}
                    disabled={isGenerating}
                >
                    <History size={16} /> {/* Use Lucide History icon */}
                </button>

                {/* Settings Button */}
                <button
                    className="icon-button"
                    title="Open Settings File"
                    onClick={onOpenSettings}
                    disabled={isGenerating} // Optionally disable during generation
                >
                    <Settings size={16} /> {/* Use Lucide Settings icon */}
                </button>

                {/* Status Indicator Dot */}
                <div
                    className="status-light"
                    title={displayStatus} // Tooltip shows detailed status
                    style={{
                        backgroundColor: statusColorVar,
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        border: '1px solid var(--vscode-panel-border)'
                    }}
                ></div>
            </div>
        </div>
    );
};
