import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { describe, it, before, after, beforeEach } from 'mocha';
import * as path from 'path';
import { setupTestEnvironment } from '../testUtils';
import { readGooseConfig, FileSystem, OS } from '../../utils/configReader';
import { logger } from '../../utils/logger';

describe('ConfigReader Tests', () => {
    let testEnv: ReturnType<typeof setupTestEnvironment>;

    // Mock implementations
    const mockFs: FileSystem = {
        existsSync: () => true,
        readFileSync: () => 'GOOSE_PROVIDER: "databricks"\nGOOSE_MODEL: "claude-3-7-sonnet"'
    };
    
    const mockOs: OS = {
        homedir: () => '/mock/home/dir',
        platform: () => 'linux'
    };

    before(() => {
        testEnv = setupTestEnvironment();
        // Stub the logger methods once before all tests in this suite
        testEnv.sandbox.stub(logger, 'debug');
        testEnv.sandbox.stub(logger, 'info');
        testEnv.sandbox.stub(logger, 'warn');
        testEnv.sandbox.stub(logger, 'error');
    });

    after(() => {
        testEnv.cleanup();
    });

    beforeEach(() => {
        // Reset history or perform other per-test setup if needed
        // Logger stubs are already set up in the 'before' hook
    });

    it('should parse valid config file and extract provider and model', () => {
        // Call the function with our mocks
        const result = readGooseConfig(mockFs, mockOs);
        
        // Verify expected result when config is valid
        assert.strictEqual(result.provider, 'databricks');
        assert.strictEqual(result.model, 'claude-3-7-sonnet');
    });

    it('should handle missing config file', () => {
        // Create mock with non-existent file
        const mockFsMissing: FileSystem = {
            existsSync: () => false,
            readFileSync: () => { throw new Error('Should not be called'); }
        };
        
        // Call the function
        const result = readGooseConfig(mockFsMissing, mockOs);
        
        // Verify null result due to missing config
        assert.strictEqual(result.provider, null);
        assert.strictEqual(result.model, null);
    });

    it('should handle invalid YAML content', () => {
        // Create mock with invalid YAML
        const mockFsInvalid: FileSystem = {
            existsSync: () => true,
            readFileSync: () => 'This is not valid YAML:::::'
        };
        
        // Call the function
        const result = readGooseConfig(mockFsInvalid, mockOs);
        
        // Verify null result due to YAML parse error
        assert.strictEqual(result.provider, null);
        assert.strictEqual(result.model, null);
    });

    it('should handle file read errors', () => {
        // Create mock that throws an error
        const mockFsError: FileSystem = {
            existsSync: () => true,
            readFileSync: () => { throw new Error('Failed to read file'); }
        };
        
        // Call the function
        const result = readGooseConfig(mockFsError, mockOs);
        
        // Verify null result due to file read error
        assert.strictEqual(result.provider, null);
        assert.strictEqual(result.model, null);
    });

    it('should handle missing GOOSE_PROVIDER key', () => {
        // Create mock with missing provider
        const mockFsNoProvider: FileSystem = {
            existsSync: () => true,
            readFileSync: () => 'GOOSE_MODEL: "claude-3-7-sonnet"'
        };
        
        // Call the function
        const result = readGooseConfig(mockFsNoProvider, mockOs);
        
        // Verify partial result with missing provider
        assert.strictEqual(result.provider, null);
        assert.strictEqual(result.model, 'claude-3-7-sonnet');
    });

    it('should handle missing GOOSE_MODEL key', () => {
        // Create mock with missing model
        const mockFsNoModel: FileSystem = {
            existsSync: () => true,
            readFileSync: () => 'GOOSE_PROVIDER: "databricks"'
        };
        
        // Call the function
        const result = readGooseConfig(mockFsNoModel, mockOs);
        
        // Verify partial result with missing model
        assert.strictEqual(result.provider, 'databricks');
        assert.strictEqual(result.model, null);
    });

    it('should handle non-string values for keys', () => {
        // Create mock with invalid types
        const mockFsInvalidTypes: FileSystem = {
            existsSync: () => true,
            readFileSync: () => 'GOOSE_PROVIDER: 123\nGOOSE_MODEL: true'
        };
        
        // Call the function
        const result = readGooseConfig(mockFsInvalidTypes, mockOs);
        
        // Verify null results due to incorrect types
        assert.strictEqual(result.provider, null);
        assert.strictEqual(result.model, null);
    });

    it('should handle empty YAML file', () => {
        // Create mock with empty file
        const mockFsEmpty: FileSystem = {
            existsSync: () => true,
            readFileSync: () => ''
        };
        
        // Call the function
        const result = readGooseConfig(mockFsEmpty, mockOs);
        
        // Verify null results due to missing config
        assert.strictEqual(result.provider, null);
        assert.strictEqual(result.model, null);
    });

    it('should use correct path for Windows', () => {
        // Spy on the mock implementation
        const readFileSpy = sinon.spy();
        
        // Create Windows mock
        const mockWinOs: OS = {
            homedir: () => 'C:\\Users\\test',
            platform: () => 'win32'
        };
        
        const mockWinFs: FileSystem = {
            existsSync: () => true,
            readFileSync: (path) => {
                readFileSpy(path);
                return 'GOOSE_PROVIDER: "databricks"\nGOOSE_MODEL: "claude-3-7-sonnet"';
            }
        };
        
        // Set APPDATA for Windows path
        const originalAppData = process.env.APPDATA;
        process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
        
        // Call the function
        const result = readGooseConfig(mockWinFs, mockWinOs);
        
        // Check the path used is Windows format
        sinon.assert.calledOnce(readFileSpy);
        const pathUsed = readFileSpy.firstCall.args[0];
        
        assert.ok(
            pathUsed.includes('AppData') &&
            pathUsed.includes('Roaming') &&
            pathUsed.includes('Block') &&
            pathUsed.includes('goose') &&
            pathUsed.includes('config') &&
            pathUsed.endsWith('config.yaml')
        );
        
        // Restore environment
        if (originalAppData) {
            process.env.APPDATA = originalAppData;
        } else {
            delete process.env.APPDATA;
        }
    });

    it('should fallback to Roaming when APPDATA is undefined', () => {
        const readFileSpy = sinon.spy();

        const mockWinOs: OS = {
            homedir: () => 'C:\\Users\\test',
            platform: () => 'win32'
        };

        const mockWinFs: FileSystem = {
            existsSync: () => true,
            readFileSync: (path) => {
                readFileSpy(path);
                return 'GOOSE_PROVIDER: "databricks"\nGOOSE_MODEL: "claude-3-7-sonnet"';
            }
        };

        // Ensure APPDATA is undefined
        const originalAppData = process.env.APPDATA;
        delete process.env.APPDATA;

        readGooseConfig(mockWinFs, mockWinOs);

        sinon.assert.calledOnce(readFileSpy);
        const pathUsed = readFileSpy.firstCall.args[0];

        assert.ok(
            pathUsed.includes('AppData') &&
            pathUsed.includes('Roaming') &&
            pathUsed.includes('Block') &&
            pathUsed.includes('goose') &&
            pathUsed.includes('config') &&
            pathUsed.endsWith('config.yaml')
        );

        if (originalAppData) {
            process.env.APPDATA = originalAppData;
        }
    });
});
