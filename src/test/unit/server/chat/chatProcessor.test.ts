import * as assert from 'assert';
import * as sinon from 'sinon';
import { ChatProcessor, ChatEvents } from '../../../../server/chat/chatProcessor';
import { ServerManager } from '../../../../server/serverManager';
import { SessionManager } from '../../../../server/chat/sessionManager';
import { logger } from '../../../../utils/logger';
import { setupTestEnvironment } from '../../../testUtils';
import { Message } from '../../../../types';
import { CodeReference } from '../../../../utils/codeReferenceManager'; // Corrected import path for CodeReference
import { formatMessageWithCodeContext } from '../../../../server/chat/chatProcessor';
import { CodeContextPart } from '../../../../types';

suite('ChatProcessor Tests - Empty Message Validation', () => {
    let chatProcessor: ChatProcessor;
    let mockServerManager: sinon.SinonStubbedInstance<ServerManager>;
    let mockSessionManager: sinon.SinonStubbedInstance<SessionManager>;
    let mockApiClient: any;
    let loggerInfoStub: sinon.SinonStub;
    let testEnv: ReturnType<typeof setupTestEnvironment>;

    setup(() => {
        testEnv = setupTestEnvironment();

        loggerInfoStub = testEnv.sandbox.stub(logger, 'info');

        mockApiClient = {
            streamChatResponse: testEnv.sandbox.stub().callsFake(async () => {
                const asyncGenerator = (async function* () {
                    yield new TextEncoder().encode(JSON.stringify({ type: 'Message', message: { role: 'assistant', content: [{ type: 'text', text: 'response part 1' }] } }));
                    yield new TextEncoder().encode(JSON.stringify({ type: 'Finish', reason: 'completed' }));
                })();

                const mockReadableStreamBody = {
                    getReader: () => {
                        const iterator = asyncGenerator[Symbol.asyncIterator]();
                        return {
                            async read() {
                                const result = await iterator.next();
                                return result; // { value: Uint8Array | undefined, done: boolean }
                            },
                            releaseLock() { },
                            get closed() { return Promise.resolve(); } // Mock closed promise
                        };
                    }
                };

                return Promise.resolve({
                    ok: true,
                    body: mockReadableStreamBody,
                    status: 200,
                    headers: new Headers()
                });

                suite('ChatProcessor Integration - API Payload', () => {
                    test('POST /reply payload contains formatted <user-request> and omits codeReferences', async () => {
                        // Arrange
                        const testEnv = setupTestEnvironment();
                        const mockApiClient = {
                            streamChatResponse: sinon.stub().resolves({
                                ok: true,
                                body: {
                                    getReader: () => ({
                                        read: async () => ({ done: true })
                                    })
                                },
                                status: 200,
                                headers: new Headers()
                            })
                        };
                        const mockServerManager = testEnv.sandbox.createStubInstance(ServerManager);
                        (mockServerManager as any).getApiClient = () => mockApiClient;
                        (mockServerManager as any).getDefensivePrompt = () => 'Defensive prompt text';
                        const mockSessionManager = testEnv.sandbox.createStubInstance(SessionManager);
                        mockSessionManager.getCurrentSessionId.returns('integration-session');
                        mockSessionManager.getSessions.returns([]);
                        const chatProcessor = new ChatProcessor(mockServerManager as unknown as ServerManager);
                        chatProcessor.setSessionManager(mockSessionManager as unknown as SessionManager);

                        // Act
                        const codeContext: CodeReference = {
                            id: 'int-1',
                            filePath: '/integration/test.js',
                            fileName: 'test.js',
                            startLine: 1,
                            endLine: 2,
                            selectedText: 'console.log("integration");',
                            languageId: 'javascript'
                        };
                        await chatProcessor.sendMessage('Integration test message', [], codeContext);

                        // Assert
                        sinon.assert.calledOnce(mockApiClient.streamChatResponse);
                        const callArgs = mockApiClient.streamChatResponse.getCall(0).args[0];
                        // The payload should have a prompt array with a user message
                        assert.ok(Array.isArray(callArgs.prompt));
                        const userMsg = callArgs.prompt.find((m: any) => m.role === 'user');
                        assert.ok(userMsg, 'User message should be present in payload');
                        // The content should be a single TextPart with <user-request>
                        assert.strictEqual(userMsg.content.length, 1);
                        assert.strictEqual(userMsg.content[0].type, 'text');
                        assert.ok(userMsg.content[0].text.includes('<user-request>'));
                        assert.ok(userMsg.content[0].text.includes('/integration/test.js'));
                        assert.ok(userMsg.content[0].text.includes('Integration test message'));
                        // There should be no codeReferences key
                        assert.strictEqual('codeReferences' in userMsg, false);
                    });
                });

                suite('formatMessageWithCodeContext', () => {
                    test('returns user query as-is when no code context', () => {
                        const result = formatMessageWithCodeContext('What does this code do?');
                        assert.strictEqual(result, 'What does this code do?');
                    });

                    test('formats message with code context (<100 lines)', () => {
                        const codeContext: CodeContextPart = {
                            id: '1',
                            filePath: '/foo/bar/baz.ts',
                            fileName: 'baz.ts',
                            startLine: 1,
                            endLine: 3,
                            selectedText: 'const x = 1;\nconst y = 2;\nconsole.log(x + y);',
                            languageId: 'typescript',
                            type: 'code_context'
                        };
                        const userQuery = 'What does this code do?';
                        const result = formatMessageWithCodeContext(userQuery, codeContext);
                        assert.ok(result.includes('<user-request>'));
                        assert.ok(result.includes("'\/foo\/bar\/baz.ts' (see below for file content)"));
                        assert.ok(result.includes('  `typescript'));
                        assert.ok(result.includes('  const x = 1;'));
                        assert.ok(result.includes('  const y = 2;'));
                        assert.ok(result.includes('  console.log(x + y);'));
                        assert.ok(result.includes('  `'));
                        assert.ok(result.includes(userQuery));
                        assert.ok(result.includes('</user-request>'));
                    });

                    test('formats message with code context (>=100 lines)', () => {
                        const codeLines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
                        const codeContext: CodeContextPart = {
                            id: '2',
                            filePath: '/foo/largefile.py',
                            fileName: 'largefile.py',
                            startLine: 1,
                            endLine: 100,
                            selectedText: codeLines,
                            languageId: 'python',
                            type: 'code_context'
                        };
                        const userQuery = 'Summarize this file.';
                        const result = formatMessageWithCodeContext(userQuery, codeContext);
                        assert.ok(result.includes('<user-request>'));
                        assert.ok(result.includes("'\/foo\/largefile.py' (see below for file content)"));
                        assert.ok(result.includes('  `python'));
                        assert.ok(result.includes("Goose, please read the file at '/foo/largefile.py'"));
                        assert.ok(result.includes('  `'));
                        assert.ok(result.includes(userQuery));
                        assert.ok(result.includes('</user-request>'));
                    });

                    test('handles various file paths and language IDs', () => {
                        const codeContext: CodeContextPart = {
                            id: '3',
                            filePath: 'C:\\Users\\user\\project\\main.cpp',
                            fileName: 'main.cpp',
                            startLine: 10,
                            endLine: 12,
                            selectedText: 'int main() {\n  return 0;\n}',
                            languageId: 'cpp',
                            type: 'code_context'
                        };
                        const userQuery = 'Explain the entry point.';
                        const result = formatMessageWithCodeContext(userQuery, codeContext);
                        assert.ok(result.includes('C:\\Users\\user\\project\\main.cpp'));
                        assert.ok(result.includes('cpp'));
                        assert.ok(result.includes('int main() {'));
                        assert.ok(result.includes('return 0;'));
                        assert.ok(result.includes('}'));
                        assert.ok(result.includes(userQuery));
                    });

                    test('handles empty selectedText as >=100 lines (instruct to read)', () => {
                        const codeContext: CodeContextPart = {
                            id: '4',
                            filePath: '/empty/file.js',
                            fileName: 'file.js',
                            startLine: 1,
                            endLine: 1,
                            selectedText: '',
                            languageId: 'javascript',
                            type: 'code_context'
                        };
                        const userQuery = 'What is in this file?';
                        const result = formatMessageWithCodeContext(userQuery, codeContext);
                        assert.ok(result.includes("Goose, please read the file at '/empty/file.js'"));
                    });
                });
            }),
        };

        mockServerManager = testEnv.sandbox.createStubInstance(ServerManager);
        (mockServerManager as any).getApiClient = testEnv.sandbox.stub().returns(mockApiClient);
        // Stub getDefensivePrompt to return a string, as it's called in sendMessage
        // The actual content doesn't matter for these tests, just that it's callable.
        (mockServerManager as any).getDefensivePrompt = testEnv.sandbox.stub().returns('Defensive prompt text');


        mockSessionManager = testEnv.sandbox.createStubInstance(SessionManager);
        mockSessionManager.getCurrentSessionId.returns('test-session-id');
        // Configure getSessions to return an empty array to prevent TypeError
        mockSessionManager.getSessions.returns([]);

        chatProcessor = new ChatProcessor(mockServerManager as unknown as ServerManager);
        chatProcessor.setSessionManager(mockSessionManager as unknown as SessionManager);
    });

    teardown(() => {
        testEnv.sandbox.restore();
    });

    test('sendMessage should log and not proceed if text is empty and no code context', async () => {
        await chatProcessor.sendMessage('', [], undefined);
        sinon.assert.calledOnceWithExactly(loggerInfoStub, 'ChatProcessor: sendMessage called with empty user text and no code context. Not proceeding.');
        sinon.assert.notCalled(mockApiClient.streamChatResponse);
    });

    test('sendMessage should log and not proceed if text is whitespace and no code context', async () => {
        await chatProcessor.sendMessage('   ', [], undefined);
        sinon.assert.calledOnceWithExactly(loggerInfoStub, 'ChatProcessor: sendMessage called with empty user text and no code context. Not proceeding.');
        sinon.assert.notCalled(mockApiClient.streamChatResponse);
    });

    test('sendMessage should log and not proceed if text is null and no code context', async () => {
        await chatProcessor.sendMessage(null as any, [], undefined);
        sinon.assert.calledOnceWithExactly(loggerInfoStub, 'ChatProcessor: sendMessage called with empty user text and no code context. Not proceeding.');
        sinon.assert.notCalled(mockApiClient.streamChatResponse);
    });

    test('sendMessage should proceed if text is empty but code references are present', async () => {
        const codeRefs: CodeReference[] = [{
            id: 'ref1',
            filePath: 'test.ts',
            fileName: 'test.ts',
            startLine: 1,
            endLine: 5,
            selectedText: 'code',
            languageId: 'typescript'
        }];

        await chatProcessor.sendMessage('', codeRefs, undefined);

        // Assert that the API call was made
        sinon.assert.calledOnce(mockApiClient.streamChatResponse);
        // Assert that no "not proceeding" log was generated
        sinon.assert.neverCalledWith(loggerInfoStub, 'ChatProcessor: sendMessage called with empty user text and no code context. Not proceeding.');
    });

    test('sendMessage should proceed if text is empty but prepended code is present', async () => {
        const prependedCode: CodeReference = {
            id: 'prepended-test-id',
            filePath: '/path/to/test.ts',
            fileName: 'test.ts',
            startLine: 1,
            endLine: 1,
            selectedText: 'code',
            languageId: 'typescript'
        };

        await chatProcessor.sendMessage('', [], prependedCode);

        // Assert that the API call was made
        sinon.assert.calledOnce(mockApiClient.streamChatResponse);
        // Assert that no "not proceeding" log was generated
        sinon.assert.neverCalledWith(loggerInfoStub, 'ChatProcessor: sendMessage called with empty user text and no code context. Not proceeding.');
    });

    test('sendMessage should proceed and call streamChatResponse if text is valid', async () => {
        loggerInfoStub.resetHistory();

        await chatProcessor.sendMessage('Hello', [], undefined);

        sinon.assert.neverCalledWith(loggerInfoStub, 'ChatProcessor: sendMessage called with empty user text and no code context. Not proceeding.');
        sinon.assert.neverCalledWith(loggerInfoStub, 'ChatProcessor: sendMessage called with empty user text (but with code context). Not proceeding as per task 2.1 focusing on user text.');

        sinon.assert.calledOnce(mockApiClient.streamChatResponse);
    });

    test('stopGeneration should set shouldStop flag and emit FINISH event', async () => {
        // Create a mock stream that yields chunks slowly
        const chunks = [
            { type: 'Message', message: { role: 'assistant', content: [{ type: 'text', text: 'response part 1' }] } },
            { type: 'Message', message: { role: 'assistant', content: [{ type: 'text', text: 'response part 2' }] } }
        ];

        let chunkIndex = 0;
        const mockSlowApiClient = {
            streamChatResponse: testEnv.sandbox.stub().callsFake(async () => {
                const mockReadableStreamBody = {
                    getReader: () => {
                        let cancelled = false;
                        return {
                            async read() {
                                if (cancelled || chunkIndex >= chunks.length) {
                                    return { done: true };
                                }

                                // Simulate slow chunks
                                await new Promise(resolve => setTimeout(resolve, 50));

                                if (cancelled) {
                                    return { done: true };
                                }

                                const chunk = chunks[chunkIndex++];
                                return {
                                    value: new TextEncoder().encode(JSON.stringify(chunk)),
                                    done: false
                                };
                            },
                            cancel() {
                                cancelled = true;
                                return Promise.resolve();
                            },
                            releaseLock() { },
                            get closed() { return Promise.resolve(); }
                        };
                    }
                };

                return Promise.resolve({
                    ok: true,
                    body: mockReadableStreamBody,
                    status: 200,
                    headers: new Headers()
                });
            })
        };

        const mockSlowServerManager = testEnv.sandbox.createStubInstance(ServerManager);
        (mockSlowServerManager as any).getApiClient = testEnv.sandbox.stub().returns(mockSlowApiClient);
        (mockSlowServerManager as any).getDefensivePrompt = testEnv.sandbox.stub().returns('Defensive prompt text');

        const testChatProcessor = new ChatProcessor(mockSlowServerManager as unknown as ServerManager);
        testChatProcessor.setSessionManager(mockSessionManager as unknown as SessionManager);

        // Set up event listener to capture FINISH event
        let finishEventCalled = false;
        let finishEventStatus = '';
        testChatProcessor.on(ChatEvents.FINISH, (_message, status) => {
            finishEventCalled = true;
            finishEventStatus = status;
        });

        // Start the message sending (this will begin streaming)
        const sendPromise = testChatProcessor.sendMessage('Test message', [], undefined);

        // Wait a bit to ensure streaming has started, then stop generation
        await new Promise(resolve => setTimeout(resolve, 10));
        testChatProcessor.stopGeneration();

        // Wait for the send to complete
        await sendPromise;

        // Verify that the stream was cancelled and FINISH event was emitted
        assert.strictEqual(finishEventCalled, true, 'FINISH event should be emitted');
        assert.strictEqual(finishEventStatus, 'stopped', 'FINISH event should have status "stopped"');
    });
});
