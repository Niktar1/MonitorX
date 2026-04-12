// logger.js
const pino = require('pino');
const config = require('./config');

// Current log level (can be changed at runtime)
let currentLogLevel = config.logLevel;

// Create a single logger instance
const logger = pino({
    level: currentLogLevel,
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
        },
    },
});

/**
 * Change the log level at runtime.
 * @param {'debug' | 'info' | 'warn' | 'error'} level
 */
function setLogLevel(level) {
    currentLogLevel = level;
    logger.level = level;
    logger.info(`Log level changed to: ${level}`);
}

/**
 * Get the current log level.
 */
function getLogLevel() {
    return currentLogLevel;
}

module.exports = logger;
module.exports.setLogLevel = setLogLevel;
module.exports.getLogLevel = getLogLevel;