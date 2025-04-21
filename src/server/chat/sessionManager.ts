import { EventEmitter } from 'events';
import { ServerManager } from '../serverManager';
import { Message } from '../../types';
import * as vscode from 'vscode';

export interface SessionMetadata {
    id: string;
    path: string;
    modified: string;
    metadata: {
        working_dir: string;
        title?: string;
        description: string;
        message_count: number;
        total_tokens: number;
    }
}

export interface Session {
    session_id: string;
    metadata: SessionMetadata['metadata'];
    messages: Message[];
}

export enum SessionEvents {
    SESSIONS_LOADED = 'sessionsLoaded',
    SESSION_LOADED = 'sessionLoaded',
    SESSION_CREATED = 'sessionCreated',
    SESSION_SWITCHED = 'sessionSwitched',
    ERROR = 'error'
}

/**
 * Manages chat sessions and their persistence
 */
export class SessionManager {
    private serverManager: ServerManager;
    private eventEmitter: EventEmitter;
    private sessions: SessionMetadata[] = [];
    private currentSessionId: string | null = null;
    private currentSession: Session | null = null;

    constructor(serverManager: ServerManager) {
        this.serverManager = serverManager;
        this.eventEmitter = new EventEmitter();
    }

    /**
     * Fetch list of available sessions
     */
    public async fetchSessions(): Promise<SessionMetadata[]> {
        try {
            const apiClient = this.serverManager.getApiClient();
            if (!apiClient || !this.serverManager.isReady()) {
                console.error('Cannot fetch sessions: Server not ready');
                return [];
            }

            try {
                const sessions = await apiClient.listSessions();
                if (Array.isArray(sessions) && sessions.length > 0) {
                    console.log(`Fetched ${sessions.length} sessions from API`);

                    // Process sessions to ensure they match our expected format
                    const processedSessions = sessions.map(session => {
                        // Make sure each session has a title and it's based on description if needed
                        if (!session.metadata.title && session.metadata.description) {
                            session.metadata.title = session.metadata.description;
                        } else if (!session.metadata.title) {
                            session.metadata.title = `Session ${session.id.slice(0, 8)}`;
                        }
                        return session;
                    });

                    this.sessions = processedSessions;
                    this.emit(SessionEvents.SESSIONS_LOADED, processedSessions);
                    return processedSessions;
                } else {
                    // No sessions available
                    console.log('No sessions returned from API');
                    this.sessions = [];
                    this.emit(SessionEvents.SESSIONS_LOADED, []);
                    return [];
                }
            } catch (error) {
                console.error('Error fetching sessions from API:', error);
                this.sessions = [];
                this.emit(SessionEvents.SESSIONS_LOADED, []);
                return [];
            }
        } catch (error) {
            console.error('Error in fetchSessions:', error);
            this.sessions = [];
            this.emit(SessionEvents.SESSIONS_LOADED, []);
            return [];
        }
    }

    /**
     * Load a specific session by ID
     */
    public async loadSession(sessionId: string): Promise<Session | null> {
        try {
            const apiClient = this.serverManager.getApiClient();
            if (!apiClient || !this.serverManager.isReady()) {
                console.error(`Cannot load session ${sessionId}: Server not ready`);
                return null;
            }

            try {
                const session = await apiClient.getSessionHistory(sessionId);

                // Make sure the session has a title property
                if (!session.metadata.title && session.metadata.description) {
                    session.metadata.title = session.metadata.description;
                }

                this.currentSessionId = sessionId;
                this.currentSession = session;
                this.emit(SessionEvents.SESSION_LOADED, session);
                return session;
            } catch (error) {
                console.error(`Error loading session ${sessionId} from API:`, error);
                return null;
            }
        } catch (error) {
            console.error(`Error in loadSession ${sessionId}:`, error);
            return null;
        }
    }

    /**
     * Switch to a different session
     */
    public async switchSession(sessionId: string): Promise<boolean> {
        try {
            const session = await this.loadSession(sessionId);
            if (session) {
                this.emit(SessionEvents.SESSION_SWITCHED, session);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`Error switching to session ${sessionId}:`, error);
            this.emit(SessionEvents.ERROR, error);
            return false;
        }
    }

    /**
     * Create a new session
     */
    public async createSession(workingDir: string, description?: string): Promise<string | null> {
        try {
            // Create a local session without API call
            const sessionId = `${new Date().toISOString().split('T')[0].replace(/-/g, '')}${new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '')}`;
            const sessionTitle = description || `Session ${new Date().toLocaleString()}`;

            console.log(`Creating local session with ID: ${sessionId}`);

            // Create a new session object
            const newSession: Session = {
                session_id: sessionId,
                metadata: {
                    working_dir: workingDir,
                    title: sessionTitle,
                    description: sessionTitle,
                    message_count: 0,
                    total_tokens: 0
                },
                messages: []
            };

            // Create session metadata
            const newSessionMetadata: SessionMetadata = {
                id: sessionId,
                path: `${workingDir}/${sessionId}`,
                modified: new Date().toISOString(),
                metadata: {
                    working_dir: workingDir,
                    title: sessionTitle,
                    description: sessionTitle,
                    message_count: 0,
                    total_tokens: 0
                }
            };

            // Update local state
            this.sessions.push(newSessionMetadata);
            this.currentSessionId = sessionId;
            this.currentSession = newSession;

            // Emit events
            this.emit(SessionEvents.SESSION_CREATED, newSession);
            this.emit(SessionEvents.SESSION_LOADED, newSession);
            this.emit(SessionEvents.SESSIONS_LOADED, this.sessions);

            return sessionId;
        } catch (error) {
            console.error('Error creating session:', error);
            this.emit(SessionEvents.ERROR, error);
            return null;
        }
    }

    /**
     * Get the current session
     */
    public getCurrentSession(): Session | null {
        return this.currentSession;
    }

    /**
     * Get the current session ID
     */
    public getCurrentSessionId(): string | null {
        return this.currentSessionId;
    }

    /**
     * Get session metadata list
     */
    public getSessions(): SessionMetadata[] {
        return this.sessions;
    }

    /**
     * Event subscription methods
     */
    public on(event: SessionEvents, listener: (...args: any[]) => void): void {
        this.eventEmitter.on(event, listener);
    }

    public off(event: SessionEvents, listener: (...args: any[]) => void): void {
        this.eventEmitter.off(event, listener);
    }

    private emit(event: SessionEvents, ...args: any[]): void {
        this.eventEmitter.emit(event, ...args);
    }
} 
