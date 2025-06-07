import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import {
    handleAskAboutSelectionCommand, // <-- Import the refactored handler
    GooseViewProvider // <-- Need for type hinting the mock provider
} from '../extension'; // Adjust path as necessary
import { CodeReferenceManager, CodeReference } from '../utils/codeReferenceManager'; // CodeReference is here
import { MessageType } from '../common-types'; // MessageType is here, WebviewMessage is not a direct export
// import * as myExtension from '../extension'; // Already imported necessary parts
import { setupTestEnvironment, getTestBinaryPathResolver } from './testUtils';
// import { CodeReferenceManager, CodeReference } from '../utils/codeReferenceManager';
// import { GooseViewProvider } from '../extension';
// import { MessageType } from '../common-types';
import * as path from 'path';

// Define constant for the limit used in extension.ts
const SELECTION_LINE_LIMIT_FOR_PREPEND = 100;

suite('Extension Test Suite', () => {
    // Declare variables in the suite scope
    let testEnv: ReturnType<typeof setupTestEnvironment>;
    let getBinaryPathStub: sinon.SinonStub;
    let serverManagerStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let registerWebviewProviderStub: sinon.SinonStub;
    let capturedProvider: GooseViewProvider | undefined;
    let postMessageSpy: sinon.SinonSpy | sinon.SinonStub; // Can be spy or stub
    let activeEditorStub: sinon.SinonStub | undefined;
    let mockContext: vscode.ExtensionContext;
    let registerCommandStub: sinon.SinonStub;
    let executeCommandStub: sinon.SinonStub;
    let getInstanceStub: sinon.SinonStub; // Stub for CodeReferenceManager.getInstance
    let mockCodeRefManager: { // Mock object returned by getInstanceStub
        getCodeReferenceFromSelection: sinon.SinonStub;
        getCodeReferenceForEntireFile: sinon.SinonStub;
        formatCodeReferenceForChat: sinon.SinonStub;
        getCodeReferenceDisplayString: sinon.SinonStub;
    };
    let providerPostMessageSpy: sinon.SinonStub;
    let getCodeReferenceFromSelectionStub: sinon.SinonStub;
    let getCodeReferenceForEntireFileStub: sinon.SinonStub;

    // Mock editor/document/selection setup helper
    const setupMockEditor = (
        selectionText: string | null,
        fileText: string,
        selectionRange?: vscode.Range,
        selectionIsEmpty = false,
        selectionIsWhitespace = false,
        fileIsEmpty = false,
        fileIsWhitespace = false
    ) => {
        // Restore previous stub if exists
        if (activeEditorStub) {
            activeEditorStub.restore();
        }

        let mockSelection: vscode.Selection;
        const mockFilePath = 'mock/test.ts'; // Define mock path

        if (selectionRange) {
            // Use provided range
            mockSelection = new vscode.Selection(selectionRange.start, selectionRange.end);
        } else if (selectionText === null || selectionIsEmpty) {
            // Simulate no selection or programmatically empty selection
            const position = new vscode.Position(0, 0);
            mockSelection = new vscode.Selection(position, position);
        } else {
            // Simulate a non-empty selection
            const startPosition = new vscode.Position(0, 0);
            // FIX: Use Position constructor for the second argument
            const endPosition = new vscode.Position(0, selectionText.length);
            mockSelection = new vscode.Selection(startPosition, endPosition);
        }

        // Mock Document
        const mockDocument: Partial<vscode.TextDocument> = {
            uri: vscode.Uri.file(mockFilePath),
            fileName: mockFilePath,
            getText: (range?: vscode.Range) => {
                if (range) {
                    if (range.isEqual(mockSelection)) {
                        return selectionIsWhitespace ? ' \t\n ' : (selectionText ?? '');
                    }
                }
                return fileIsWhitespace ? ' \t \n ' : fileText;
            },
            lineCount: fileText.split('\n').length,
            languageId: 'typescript',
            isDirty: false,
            isClosed: false,
            isUntitled: false,
            eol: vscode.EndOfLine.LF,
            version: 1,
            validatePosition: (pos) => pos, // Simplified validation
            validateRange: (range) => range, // Simplified validation
            positionAt: (offset) => new vscode.Position(0, offset), // Simplified
            offsetAt: (pos) => pos.character, // Simplified
            // FIX: Handle both number and Position input for line, like the real API
            lineAt: (lineOrPosition: number | vscode.Position): vscode.TextLine => {
                const lineNumber = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
                const lineText = fileText.split('\n')[lineNumber] ?? '';
                const range = new vscode.Range(lineNumber, 0, lineNumber, lineText.length);
                const rangeIncludingLineBreak = new vscode.Range(lineNumber, 0, lineNumber + 1, 0); // Approx
                const firstNonWhitespace = lineText.search(/\S|$/);
                return {
                    lineNumber: lineNumber,
                    text: lineText,
                    range: range,
                    rangeIncludingLineBreak: rangeIncludingLineBreak,
                    firstNonWhitespaceCharacterIndex: firstNonWhitespace === -1 ? 0 : firstNonWhitespace, // Handle empty/whitespace lines
                    isEmptyOrWhitespace: lineText.trim().length === 0
                } as vscode.TextLine;
            },
            save: async () => true,
            getWordRangeAtPosition: (pos) => new vscode.Range(pos, pos) // Simplified

        };

        // Mock References for CodeReferenceManager stubs
        // FIX: Use selectedText, add id and filePath
        const mockSelectionRef: CodeReference | null =
            (selectionText && !selectionIsEmpty && !selectionIsWhitespace)
                ? { id: 'mock-selection-ref', filePath: mockFilePath, selectedText: selectionText, fileName: 'test.ts', startLine: 1, endLine: 1, languageId: 'typescript' }
                : null;

        // FIX: Use selectedText, add id and filePath
        const mockFileRef: CodeReference | null =
            (!fileIsEmpty && !fileIsWhitespace)
                ? { id: 'mock-file-ref', filePath: mockFilePath, selectedText: fileText, fileName: 'test.ts', startLine: 1, endLine: mockDocument.lineCount || 1, languageId: 'typescript' }
                : null;

        // Adjust stubs to return the new mocks
        mockCodeRefManager.getCodeReferenceFromSelection.callsFake(() => {
            // Simulate the check for whitespace/empty that the real method does
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty || (selectionText && selectionText.trim() === '')) { return null; }
            return mockSelectionRef;
        });
        mockCodeRefManager.getCodeReferenceForEntireFile.callsFake((doc: vscode.TextDocument) => {
            // Simulate the check for whitespace/empty that the real method does
            const text = doc.getText(); // Gets full text
            if (!text || text.trim() === '') { return null; }
            return mockFileRef;
        });

        const mockEditor: Partial<vscode.TextEditor> = {
            document: mockDocument as vscode.TextDocument,
            selection: mockSelection,
            // Add other properties/methods if needed by the command
        };

        activeEditorStub = testEnv.sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor as vscode.TextEditor);
    };

    // Runs ONCE before all tests in this suite
    suiteSetup(async () => {
        testEnv = setupTestEnvironment();
        // Stub VS Code API functions
        registerCommandStub = testEnv.sandbox.stub(vscode.commands, 'registerCommand');
        executeCommandStub = testEnv.sandbox.stub(vscode.commands, 'executeCommand');
        showInformationMessageStub = testEnv.sandbox.stub(vscode.window, 'showInformationMessage');

        // --- Stub CodeReferenceManager.getInstance --- VVV
        // Create stubs for the methods first
        const getSelectionStub = testEnv.sandbox.stub();
        const getFileStub = testEnv.sandbox.stub();
        const formatCodeReferenceForChatStub = testEnv.sandbox.stub();
        const getCodeReferenceDisplayStringStub = testEnv.sandbox.stub();
        mockCodeRefManager = {
            getCodeReferenceFromSelection: getSelectionStub,
            getCodeReferenceForEntireFile: getFileStub,
            formatCodeReferenceForChat: formatCodeReferenceForChatStub,
            getCodeReferenceDisplayString: getCodeReferenceDisplayStringStub,
        };
        // Stub getInstance to return our mock object
        getInstanceStub = testEnv.sandbox.stub(CodeReferenceManager, 'getInstance').returns(mockCodeRefManager);
        // --- Stub CodeReferenceManager.getInstance --- ^^^^

        // Stub and capture the provider
        registerWebviewProviderStub = testEnv.sandbox.stub(vscode.window, 'registerWebviewViewProvider');
        registerWebviewProviderStub.callsFake((_viewId, provider, _options) => {
            capturedProvider = provider as GooseViewProvider;
            // Restore any previous spy/stub assigned to postMessageSpy first
            if (postMessageSpy && typeof postMessageSpy.restore === 'function') {
                postMessageSpy.restore();
            }
            // Now, attempt to create the spy on the captured provider
            if (capturedProvider && typeof capturedProvider.postMessage === 'function') {
                postMessageSpy = testEnv.sandbox.spy(capturedProvider, 'postMessage');
                console.log('Successfully spied on postMessage.');
            } else {
                // If spying fails, assign a stub and log warning
                console.warn('Warning: Could not find postMessage on captured provider. Assigning stub to postMessageSpy.');
                postMessageSpy = testEnv.sandbox.stub();
            }
            return { dispose: sinon.stub() };
        });

        // Create Mock Context (needed for activation)
        mockContext = {
            subscriptions: [],
            extensionPath: '/test/extension',
            extensionUri: vscode.Uri.file('/test/extension'),
            asAbsolutePath: (p: string) => path.join('/test/extension', p),
            storageUri: vscode.Uri.file('/test/storage'), // Provide a valid URI
            globalState: { get: testEnv.sandbox.stub(), update: testEnv.sandbox.stub(), setKeysForSync: testEnv.sandbox.stub() } as any,
            workspaceState: { get: testEnv.sandbox.stub(), update: testEnv.sandbox.stub() } as any,
            secrets: { get: testEnv.sandbox.stub(), store: testEnv.sandbox.stub(), delete: testEnv.sandbox.stub(), onDidChange: testEnv.sandbox.stub().returns({ dispose: () => { } }) } as any,
            extensionMode: vscode.ExtensionMode.Test, // Use Test mode
            globalStorageUri: vscode.Uri.file('/test/globalStorage'),
            logUri: vscode.Uri.file('/test/logs'),
            logPath: '/test/logs',
            environmentVariableCollection: {} as any, // Add missing properties if needed by activate
            extension: {} as any,
            storagePath: '/test/storage_obsolete', // deprecated but might be needed
            globalStoragePath: '/test/globalStorage_obsolete', // deprecated
            languageModelAccessInformation: {
                onDidChange: testEnv.sandbox.stub().returns({ dispose: () => { } }),
                canSendRequest: testEnv.sandbox.stub().returns(true) // Mock implementation
            }
        };

    });

    // Runs ONCE after all tests in this suite
    suiteTeardown(() => {
        if (testEnv) {
            testEnv.sandbox.restore(); // FIX: Use sandbox.restore()
        }
        // Explicitly restore static stub if sandbox didn't catch it (shouldn't be necessary but safe)
        if (getInstanceStub && typeof getInstanceStub.restore === 'function') {
            getInstanceStub.restore();
        }
    });

    // --- Hooks per test ---

    // Runs BEFORE EACH test
    setup(() => {
        // Reset history of mocks/stubs that persist across tests
        registerCommandStub.resetHistory();
        executeCommandStub.resetHistory();
        showInformationMessageStub.resetHistory();

        // Reset stubs on the mock CodeReferenceManager
        mockCodeRefManager.getCodeReferenceFromSelection.resetHistory();
        mockCodeRefManager.getCodeReferenceFromSelection.resolves(null); // Default return value
        mockCodeRefManager.getCodeReferenceForEntireFile.resetHistory();
        mockCodeRefManager.getCodeReferenceForEntireFile.resolves(null); // Default return value
        mockCodeRefManager.formatCodeReferenceForChat.resetHistory();
        mockCodeRefManager.formatCodeReferenceForChat.resolves('Formatted ref'); // Default return value
        mockCodeRefManager.getCodeReferenceDisplayString.resetHistory();
        mockCodeRefManager.getCodeReferenceDisplayString.resolves('Display ref'); // Default return value

        // Reset the sendMessageToWebview spy/stub history
        if (postMessageSpy && typeof postMessageSpy.resetHistory === 'function') {
            postMessageSpy.resetHistory();
        }

        // Reset active editor stub (will be set by setupMockEditor if needed)
        if (activeEditorStub) {
            activeEditorStub.restore();
            activeEditorStub = undefined;
        }
    });

    // Runs AFTER EACH test
    teardown(() => {
        // Sandbox automatically restores stubs created within the 'setup' scope
        // But need to restore activeEditorStub if setupMockEditor was called
        if (activeEditorStub) {
            activeEditorStub.restore();
            activeEditorStub = undefined;
        }
        // No need to restore suite-level stubs here (CodeReferenceManager, showInfoMsg etc.)
        // Sandbox handles those in suiteTeardown
    });

    // --- Tests ---
    suite('goose.askAboutSelection Command Tests', () => {
        let mockProviderInstance: Partial<GooseViewProvider>;
        let mockCodeRefManager: sinon.SinonStubbedInstance<CodeReferenceManager>; // Use SinonStubbedInstance
        let providerPostMessageSpy: sinon.SinonStub;
        let getCodeReferenceFromSelectionStub: sinon.SinonStub;
        let getCodeReferenceForEntireFileStub: sinon.SinonStub;

        // Runs before each test in THIS suite
        setup(() => {
            // Reset mocks before each test to ensure isolation
            mockProviderInstance = {
                postMessage: testEnv.sandbox.stub(),
                // Add other methods/properties of GooseViewProvider if they are called by handleAskAboutSelectionCommand
                // and not already handled by general stubs (like _view or _extensionUri if needed).
            };

            // Create a stubbed instance of CodeReferenceManager for each test
            // We can't easily stub a true singleton's methods across tests without them interfering.
            // So, for testing, we'll create a fresh stub object that *looks* like CodeReferenceManager.
            mockCodeRefManager = testEnv.sandbox.createStubInstance(CodeReferenceManager);

            // Assign the stubs to our suite-level variables so tests can use them for `returns` etc.
            getCodeReferenceFromSelectionStub = mockCodeRefManager.getCodeReferenceFromSelection;
            getCodeReferenceForEntireFileStub = mockCodeRefManager.getCodeReferenceForEntireFile;

            // Spy on the postMessage of the mock provider
            providerPostMessageSpy = mockProviderInstance.postMessage as sinon.SinonStub;

            if (providerPostMessageSpy && typeof providerPostMessageSpy.resetHistory === 'function') {
                providerPostMessageSpy.resetHistory();
            } else {
                console.warn('Could not reset providerPostMessageSpy');
            }

            // Ensure activeTextEditor is stubbed for each test in this suite
            // The setupMockEditor helper will be called by each test as needed.
        });

        test('should show message if file is empty (no selection)', async () => {
            setupMockEditor(null, '', undefined, true, false, true);
            // Execute the command handler directly
            await handleAskAboutSelectionCommand(mockProviderInstance as GooseViewProvider, mockCodeRefManager);
            sinon.assert.calledWith(showInformationMessageStub, 'Active file is empty or contains only whitespace.');
            sinon.assert.notCalled(getCodeReferenceForEntireFileStub); // Should not try to get ref
            sinon.assert.notCalled(providerPostMessageSpy); // Should not send any message
        });

        test('should show message if file is only whitespace (no selection)', async () => {
            setupMockEditor(null, '   \n\t   ', undefined, true, false, false, true);
            await handleAskAboutSelectionCommand(mockProviderInstance as GooseViewProvider, mockCodeRefManager);
            sinon.assert.calledWith(showInformationMessageStub, 'Active file is empty or contains only whitespace.');
            sinon.assert.notCalled(getCodeReferenceForEntireFileStub);
            sinon.assert.notCalled(providerPostMessageSpy);
        });

        test('should send PREPARE_MESSAGE_WITH_CODE for valid file < limit (no selection)', async () => {
            const fileContent = 'const hello = "world";\nconsole.log(hello);';
            const expectedPayload = {
                content: fileContent,
                fileName: 'test.ts',
                languageId: 'typescript',
                startLine: 1,
                endLine: 2
            };
            setupMockEditor(null, fileContent, undefined, true, false, false, false);

            await handleAskAboutSelectionCommand(mockProviderInstance as GooseViewProvider, mockCodeRefManager);

            sinon.assert.notCalled(getCodeReferenceForEntireFileStub); // Should not use manager for small files
            sinon.assert.calledTwice(providerPostMessageSpy);
            sinon.assert.calledWith(providerPostMessageSpy, sinon.match({
                command: MessageType.PREPARE_MESSAGE_WITH_CODE,
                payload: sinon.match(expectedPayload)
            }));
            sinon.assert.calledWith(providerPostMessageSpy, sinon.match({
                command: MessageType.FOCUS_CHAT_INPUT
            }));
        });

        test('should send ADD_CODE_REFERENCE for valid file >= limit (no selection)', async () => {
            const fileContent = 'const hello = "world";\nconsole.log(hello);\n'.repeat(50);
            const mockFileReference: CodeReference = {
                id: 'mock-file-ref',
                filePath: 'mock/test.ts',
                selectedText: fileContent, // Entire file content
                fileName: 'test.ts',
                startLine: 1,
                endLine: 100,
                languageId: 'typescript'
            };
            setupMockEditor(null, fileContent, undefined, true, false, false, false);
            getCodeReferenceForEntireFileStub.returns(mockFileReference);

            await handleAskAboutSelectionCommand(mockProviderInstance as GooseViewProvider, mockCodeRefManager);

            sinon.assert.calledOnce(getCodeReferenceForEntireFileStub);
            sinon.assert.calledTwice(providerPostMessageSpy);
            sinon.assert.calledWith(providerPostMessageSpy, sinon.match({
                command: MessageType.ADD_CODE_REFERENCE,
                codeReference: mockFileReference
            }));
            sinon.assert.calledWith(providerPostMessageSpy, sinon.match({
                command: MessageType.FOCUS_CHAT_INPUT
            }));
        });

        test('should show message if selection is only whitespace', async () => {
            setupMockEditor('   \t\n  ', 'Some file content', undefined, false, true);
            await handleAskAboutSelectionCommand(mockProviderInstance as GooseViewProvider, mockCodeRefManager);
            sinon.assert.calledWith(showInformationMessageStub, 'Selected text is empty or contains only whitespace.');
            sinon.assert.notCalled(getCodeReferenceFromSelectionStub);
            sinon.assert.notCalled(providerPostMessageSpy);
        });

        test('should send PREPARE_MESSAGE_WITH_CODE for valid selection < limit', async () => {
            const selectionText = 'console.log("selected");';
            // Update expectedPayload to match the CodeReference structure
            const expectedPayload = {
                id: sinon.match.string, // ID is generated with Date.now()
                filePath: '/mock/test.ts', // fsPath usually prepends a slash for Uri.file
                fileName: 'test.ts',
                selectedText: selectionText, // Changed from content
                languageId: 'typescript',
                startLine: 5,
                endLine: 5
            };
            const testSelectionRange = new vscode.Selection(
                new vscode.Position(4, 0), // start Line 5 (0-based)
                new vscode.Position(4, selectionText.length) // end Line 5
            );
            setupMockEditor(selectionText, 'File content\n'.repeat(10), testSelectionRange, false, false);

            await handleAskAboutSelectionCommand(mockProviderInstance as GooseViewProvider, mockCodeRefManager);

            sinon.assert.notCalled(getCodeReferenceFromSelectionStub); // Manager not used for small selections
            sinon.assert.calledTwice(providerPostMessageSpy);
            sinon.assert.calledWith(providerPostMessageSpy, sinon.match({
                command: MessageType.PREPARE_MESSAGE_WITH_CODE,
                payload: sinon.match(expectedPayload)
            }));
            sinon.assert.calledWith(providerPostMessageSpy, sinon.match({
                command: MessageType.FOCUS_CHAT_INPUT
            }));
        });

        test('should send ADD_CODE_REFERENCE for valid selection >= limit', async () => {
            const selectionText = 'const hello = "world";\nconsole.log(hello);\n'.repeat(50);
            const mockSelectionReference: CodeReference = {
                id: 'mock-selection-ref',
                filePath: 'mock/test.ts',
                selectedText: selectionText,
                fileName: 'test.ts',
                startLine: 1,
                endLine: 100,
                languageId: 'typescript'
            };
            const largeSelectionRange = new vscode.Selection(
                new vscode.Position(0, 0), // start Line 1 (0-based)
                new vscode.Position(99, selectionText.length) // end Line 100
            );
            setupMockEditor(selectionText, 'File content\n'.repeat(10), largeSelectionRange, false, false);
            getCodeReferenceFromSelectionStub.returns(mockSelectionReference);

            await handleAskAboutSelectionCommand(mockProviderInstance as GooseViewProvider, mockCodeRefManager);

            sinon.assert.calledOnce(getCodeReferenceFromSelectionStub);
            sinon.assert.calledTwice(providerPostMessageSpy);
            sinon.assert.calledWith(providerPostMessageSpy, sinon.match({
                command: MessageType.ADD_CODE_REFERENCE,
                codeReference: mockSelectionReference
            }));
            sinon.assert.calledWith(providerPostMessageSpy, sinon.match({
                command: MessageType.FOCUS_CHAT_INPUT
            }));
        });
    }); // End of 'goose.askAboutSelection Command Tests' suite
}); // End of 'Goose Extension Tests' suite
