const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Ensure Playwright is installed and browsers are downloaded
console.log('Ensuring Playwright browsers are installed...');
execSync('npx playwright install chromium', { stdio: 'inherit' });

// Get the actual Chromium executable path
const { chromium } = require('playwright');
const executablePath = chromium.executablePath();

// The executable is inside a folder like: ...\chrome-win\chrome.exe
// We need to copy the entire 'chrome-win' folder
const browserDir = path.dirname(executablePath); // chrome-win folder
const browserParentDir = path.dirname(browserDir); // the versioned folder, e.g., chromium-1124

// Destination in project: node_modules/playwright-core/.local-browsers/chromium/
const destDir = path.join(__dirname, '..', 'node_modules', 'playwright-core', '.local-browsers', 'chromium');

console.log(`Source browser folder: ${browserParentDir}`);
console.log(`Destination folder: ${destDir}`);

// Remove existing destination if present
if (fs.existsSync(destDir)) {
    console.log('Removing existing destination...');
    fs.rmSync(destDir, { recursive: true, force: true });
}

// Ensure parent directory exists
fs.mkdirSync(destDir, { recursive: true });

// Copy the entire versioned folder (contains chrome-win, etc.)
console.log('Copying browser files (this may take a minute)...');
fs.cpSync(browserParentDir, destDir, { recursive: true });

console.log('✓ Playwright browser copied to project.');