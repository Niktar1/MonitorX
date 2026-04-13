// logger.js
const winston = require('winston');
const path = require('path');
const config = require('./config');

// Log directory - resolved in config (pkg-safe)
const logDir = config.logsDir;

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`;
});

// Current log level (can be changed at runtime)
let currentLogLevel = config.logLevel;

const logger = winston.createLogger({
    level: currentLogLevel,
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
    ),
    transports: [
        // Console transport
        new winston.transports.Console({
            format: combine(
                colorize(),
                timestamp({ format: 'HH:mm:ss' }),
                logFormat
            )
        }),
        // File transport for persistent logs
        new winston.transports.File({
            filename: path.join(logDir, 'app.log'),
            level: 'debug'
        })
    ]
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

// Ensure log directory exists (for file transport)
const fs = require('fs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

module.exports = logger;
module.exports.setLogLevel = setLogLevel;
module.exports.getLogLevel = getLogLevel;