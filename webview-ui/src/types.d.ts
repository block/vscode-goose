export enum MessageType {
    HELLO = 'hello',
    CHAT_RESPONSE = 'chatResponse',
    AI_MESSAGE = 'aiMessage',
    SERVER_STATUS = 'serverStatus',
    SERVER_EXIT = 'serverExit',
    GENERATION_FINISHED = 'generationFinished',
    ERROR = 'error',
    SEND_CHAT_MESSAGE = 'sendChatMessage',
    STOP_GENERATION = 'stopGeneration',
    GET_SERVER_STATUS = 'getServerStatus',
    ADD_CODE_REFERENCE = 'addCodeReference',
    CODE_REFERENCE = 'codeReference',
    REMOVE_CODE_REFERENCE = 'removeCodeReference',
    SESSION_LOADED = 'sessionLoaded',
    SESSIONS_LIST = 'sessionsList'
}
