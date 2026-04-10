// core/scraper.js
const logger = require('../logger');

async function extractPostIds(page, groupUrl) {
    const MAX_RETRIES = 2;
    let attempt = 0;
    
    while (attempt <= MAX_RETRIES) {
        try {
            logger.debug(`Navigating to ${groupUrl} (attempt ${attempt + 1})`);
            await page.goto(groupUrl, { 
                waitUntil: 'domcontentloaded', 
                timeout: 60000 
            });
            
            await page.waitForSelector('div[role="feed"]', { timeout: 15000 }).catch(() => {
                logger.warn('Feed not found, continuing...');
            });
            
            await page.evaluate(() => window.scrollBy(0, 800));
            await page.waitForTimeout(2000);
            
            const postLinks = await page.$$eval('a[href*="/posts/"]', anchors => 
                anchors.map(a => a.href).filter(href => href.includes('/posts/'))
            );
            
            const postIdRegex = /\/posts\/([^/?]+)/;
            const postIds = [...new Set(
                postLinks
                    .map(link => {
                        const match = link.match(postIdRegex);
                        return match ? match[1] : null;
                    })
                    .filter(id => id !== null)
            )];
            
            logger.debug(`Found ${postIds.length} unique post IDs.`);
            return postIds;
            
        } catch (error) {
            attempt++;
            logger.warn(`Scrape attempt ${attempt} failed: ${error.message}`);
            if (attempt > MAX_RETRIES) {
                logger.error(`All retries failed for ${groupUrl}`);
                return [];
            }
            await page.waitForTimeout(3000);
        }
    }
    return [];
}

function getNewPostIds(currentIds, lastId) {
    if (!lastId) {
        return currentIds;
    }
    const lastIndex = currentIds.indexOf(lastId);
    if (lastIndex === -1) {
        return currentIds;
    }
    return currentIds.slice(0, lastIndex);
}

module.exports = { extractPostIds, getNewPostIds };