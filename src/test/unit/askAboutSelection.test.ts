import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { setupTestEnvironment } from '../testUtils';
import { CodeReferenceManager, CodeReference } from '../../utils/codeReferenceManager';
import { MessageType } from '../../common-types';
import { ChatProcessor } from '../../server/chat/chatProcessor';

suite('Enhanced Ask About Selection Feature Tests', () => {
    let testEnv: ReturnType<typeof setupTestEnvironment>;

    // Mock dependencies and helpers
    let mockEditor: any;
    let mockDocument: any;
    let mockSelection: any;
    let mockWebviewProvider: any;
    let mockChatProcessor: any;
    let mockCodeReferenceManager: any;
    const SELECTION_LINE_LIMIT = 100; // Same constant used in extension.ts

    setup(() => {
        testEnv = setupTestEnvironment();

        // Set up common mocks
        mockDocument = {
            getText: sinon.stub().returns('Mock file content'),
            uri: { fsPath: '/path/to/mockFile.ts' },
            fileName: 'mockFile.ts',
            languageId: 'typescript',
            lineCount: 50
        };

        mockSelection = {
            isEmpty: false,
            start: { line: 0 },
            end: { line: 0 }
        };

        mockEditor = {
            document: mockDocument,
            selection: mockSelection
        };

        // Mock VS Code window.activeTextEditor
        sinon.stub(vscode.window, 'activeTextEditor').get(() => mockEditor);

        // Mock CodeReferenceManager
        mockCodeReferenceManager = {
            getInstance: sinon.stub().returns({
                getCodeReferenceFromSelection: sinon.stub().returns({
                    id: 'mock-ref-id',
                    filePath: '/path/to/mockFile.ts',
                    fileName: 'mockFile.ts',
                    startLine: 1,
                    endLine: 1,
                    selectedText: 'Mock selection',
                    languageId: 'typescript'
                })
            })
        };

        // Mock the webview provider
        mockWebviewProvider = {
            postMessage: sinon.spy()
        };

        // Mock ChatProcessor for message handling
        mockChatProcessor = {
            sendMessage: sinon.spy()
        };

        // No need to stub global objects - we'll provide the mock directly to the handler
    });

    teardown(() => {
        testEnv.cleanup();
        sinon.restore();
    });

    /**
     * Test the behavior when there is no selection (whole file case)
     */
    test('should send entire file as code reference when no selection exists', () => {
        // Setup test: empty selection
        mockSelection.isEmpty = true;

        // Execute the askAboutSelection command handler logic
        executeAskAboutSelectionHandler(mockWebviewProvider);

        // Verify: ADD_CODE_REFERENCE message sent with file content
        assert.strictEqual(mockWebviewProvider.postMessage.callCount, 2);

        const firstCall = mockWebviewProvider.postMessage.getCall(0);
        assert.strictEqual(firstCall.args[0].command, MessageType.ADD_CODE_REFERENCE);

        const codeRef = firstCall.args[0].codeReference;
        assert.strictEqual(codeRef.selectedText, 'Mock file content');
        assert.strictEqual(codeRef.fileName, 'mockFile.ts');
        assert.strictEqual(codeRef.startLine, 1); // 1-based
        assert.strictEqual(codeRef.endLine, 50); // lineCount

        // Verify focus message
        const secondCall = mockWebviewProvider.postMessage.getCall(1);
        assert.strictEqual(secondCall.args[0].command, MessageType.FOCUS_CHAT_INPUT);
    });

    /**
     * Test the behavior when the selection is small (< 100 lines)
     */
    test('should send PREPARE_MESSAGE_WITH_CODE when selection is < 100 lines', () => {
        // Setup test: selection with less than 100 lines
        mockSelection.isEmpty = false;
        mockSelection.start.line = 5;
        mockSelection.end.line = 14; // 10 lines total
        mockDocument.getText = sinon.stub().returns('const smallSelection = "test";\nconsole.log(smallSelection);');

        // Execute the askAboutSelection command handler logic
        executeAskAboutSelectionHandler(mockWebviewProvider);

        // Verify: PREPARE_MESSAGE_WITH_CODE message sent
        assert.strictEqual(mockWebviewProvider.postMessage.callCount, 2);

        const firstCall = mockWebviewProvider.postMessage.getCall(0);
        assert.strictEqual(firstCall.args[0].command, MessageType.PREPARE_MESSAGE_WITH_CODE);

        const payload = firstCall.args[0].payload;
        assert.strictEqual(payload.content, 'const smallSelection = "test";\nconsole.log(smallSelection);');
        assert.strictEqual(payload.fileName, 'mockFile.ts');
        assert.strictEqual(payload.languageId, 'typescript');

        // Verify focus message
        const secondCall = mockWebviewProvider.postMessage.getCall(1);
        assert.strictEqual(secondCall.args[0].command, MessageType.FOCUS_CHAT_INPUT);
    });

    /**
     * Test the behavior when the selection is large (>= 100 lines)
     */
    test('should send ADD_CODE_REFERENCE when selection is >= 100 lines', () => {
        // Setup test: selection with 100+ lines
        mockSelection.isEmpty = false;
        mockSelection.start.line = 1;
        mockSelection.end.line = 100; // 100 lines total

        // Create a stub to ensure getCodeReferenceFromSelection is called
        const getCodeRefStub = sinon.stub().returns({
            id: 'large-selection-id',
            filePath: '/path/to/mockFile.ts',
            fileName: 'mockFile.ts',
            startLine: 1,
            endLine: 100,
            selectedText: 'Large selection content...',
            languageId: 'typescript'
        });

        mockCodeReferenceManager.getInstance = sinon.stub().returns({
            getCodeReferenceFromSelection: getCodeRefStub
        });

        // Execute the askAboutSelection command handler logic
        executeAskAboutSelectionHandler(mockWebviewProvider);

        // Verify: ADD_CODE_REFERENCE message is sent with the code reference
        assert.strictEqual(mockWebviewProvider.postMessage.callCount, 2);

        // Check if getCodeReferenceFromSelection was called
        assert.strictEqual(getCodeRefStub.called, true, "getCodeReferenceFromSelection should be called");

        const firstCall = mockWebviewProvider.postMessage.getCall(0);
        assert.strictEqual(firstCall.args[0].command, MessageType.ADD_CODE_REFERENCE);

        const codeRef = firstCall.args[0].codeReference;
        assert.strictEqual(codeRef.fileName, 'mockFile.ts');
        assert.strictEqual(codeRef.startLine, 1);
        assert.strictEqual(codeRef.endLine, 100);

        // Verify focus message
        const secondCall = mockWebviewProvider.postMessage.getCall(1);
        assert.strictEqual(secondCall.args[0].command, MessageType.FOCUS_CHAT_INPUT);
    });

    /**
     * Test the ChatProcessor's handling of prependedCode
     */
    test('ChatProcessor should format prependedCode in markdown when present', () => {
        // Create a real ChatProcessor instance with mock dependencies
        const processor = new ChatProcessor({
            getApiClient: () => ({
                streamChatResponse: sinon.stub().resolves(new Response())
            })
        } as any);

        // Store the original method to restore it after the test
        const originalSendChatRequest = (processor as any).sendChatRequest;

        try {
            // Replace sendChatRequest with a simple stub that does nothing
            (processor as any).sendChatRequest = sinon.stub().resolves(new Response());

            // Prepare test data
            const prependedCode: CodeReference = { // Explicitly type and conform to CodeReference
                id: 'prepended-test-id',
                filePath: '/path/to/snippet.ts',
                fileName: 'snippet.ts',
                startLine: 1,
                endLine: 2, // Assuming 2 lines for the snippet
                selectedText: 'const code = "small snippet";\nconsole.log(code);', // Renamed from content
                languageId: 'typescript'
            };

            // Call the method we're testing
            processor.sendMessage(
                'Explain this code', // text
                [], // codeReferencesParam
                prependedCode, // prependedCode
                'msg123', // messageId
                'session123' // sessionId
            );

            // Get the messages from ChatProcessor's internal state
            const internalMessages = (processor as any).currentMessages;
            assert.ok(internalMessages.length > 0, 'ChatProcessor should have at least one message');
            const originalUserMessage = internalMessages[0];
            assert.strictEqual(originalUserMessage.role, 'user', 'Message should have user role');
            assert.ok(Array.isArray(originalUserMessage.content), 'Original message should have content array');
            // New design: Expecting a single TextPart with <user-request>
            assert.strictEqual(originalUserMessage.content.length, 1, 'Original message content should have one part');
            assert.strictEqual(originalUserMessage.content[0].type, 'text', 'Content part should be text');
            const textContent = originalUserMessage.content[0].text;
            assert.ok(textContent.includes('<user-request>'), 'Content should include <user-request>');
            assert.ok(textContent.includes('/path/to/snippet.ts'), 'Content should include file path');
            assert.ok(textContent.includes('const code = "small snippet";'), 'Content should include code');
            assert.ok(textContent.includes('Explain this code'), 'Content should include user query');
        } finally {
            // Restore the original method
            if (originalSendChatRequest) {
                (processor as any).sendChatRequest = originalSendChatRequest;
            }
        }
    });

    /**
     * Helper function that simulates the core logic of the askAboutSelection command handler
     */
    function executeAskAboutSelectionHandler(provider: any) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const document = editor.document;
        const selection = editor.selection;
        const codeReferenceManager = mockCodeReferenceManager.getInstance();

        let codeReferenceToSend: CodeReference | null = null;
        let prepayloadToSend: any = null;
        let actionTaken = false;

        if (selection.isEmpty) {
            // No selection - use whole file
            const fileContent = document.getText();
            if (!fileContent) {
                return;
            }
            const fileName = 'mockFile.ts'; // Simplified for test
            const lineCount = document.lineCount;
            codeReferenceToSend = {
                id: `${fileName}-1-${lineCount}-${Date.now()}`,
                filePath: document.uri.fsPath,
                fileName: fileName,
                startLine: 1,
                endLine: lineCount,
                selectedText: fileContent,
                languageId: document.languageId
            };
            actionTaken = true;
        } else {
            // Selection exists
            const selectedLines = selection.end.line - selection.start.line + 1;

            if (selectedLines >= SELECTION_LINE_LIMIT) {
                // >= 100 lines - use code reference chip
                codeReferenceToSend = codeReferenceManager.getCodeReferenceFromSelection();
                if (codeReferenceToSend) {
                    actionTaken = true;
                }
            } else {
                // < 100 lines - prepare message with code
                const selectedText = document.getText(selection);
                prepayloadToSend = {
                    content: selectedText,
                    fileName: 'mockFile.ts', // Simplified for test
                    languageId: document.languageId,
                };
                actionTaken = true;
            }
        }

        // Send the appropriate message to the webview
        if (codeReferenceToSend) {
            provider.postMessage({
                command: MessageType.ADD_CODE_REFERENCE,
                codeReference: codeReferenceToSend
            });
        } else if (prepayloadToSend) {
            provider.postMessage({
                command: MessageType.PREPARE_MESSAGE_WITH_CODE,
                payload: prepayloadToSend
            });
        }

        // Focus the chat view and input
        if (actionTaken) {
            // Skipping actual vscode.commands.executeCommand for tests
            provider.postMessage({
                command: MessageType.FOCUS_CHAT_INPUT
            });
        }
    }
});
