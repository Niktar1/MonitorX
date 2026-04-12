const crypto = require('crypto');
const logger = require('../logger');

const FACEBOOK_ORIGIN = 'https://www.facebook.com';
const FEED_READY_SELECTORS = [
    'div[role="feed"]',
    'div[role="main"] div[role="article"]',
    'div[aria-posinset]'
];

function hashText(value) {
    return crypto.createHash('sha1').update(value).digest('hex');
}

function squashWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeFacebookUrl(rawUrl) {
    if (!rawUrl) {
        return null;
    }

    try {
        const url = new URL(rawUrl, FACEBOOK_ORIGIN);
        if (!/facebook\.com$/i.test(url.hostname)) {
            return null;
        }

        url.protocol = 'https:';
        url.hostname = 'www.facebook.com';
        url.hash = '';

        // Keep only the parameters that are useful for canonical post URLs.
        const allowedParams = new URLSearchParams();
        for (const key of ['story_fbid', 'fbid', 'id', 'multi_permalinks']) {
            const value = url.searchParams.get(key);
            if (value) {
                allowedParams.set(key, value);
            }
        }
        url.search = allowedParams.toString();

        return url.toString();
    } catch (error) {
        return null;
    }
}

function extractGroupRef(groupUrl) {
    const normalized = normalizeFacebookUrl(groupUrl);
    if (!normalized) {
        return null;
    }

    const match = normalized.match(/\/groups\/([^/?#]+)/i);
    return match ? match[1] : null;
}

function buildCanonicalGroupPostUrl(groupRef, postId) {
    if (!groupRef || !postId) {
        return null;
    }

    return `${FACEBOOK_ORIGIN}/groups/${groupRef}/posts/${postId}`;
}

function extractPostReferenceFromUrl(rawUrl, fallbackGroupRef) {
    const normalizedUrl = normalizeFacebookUrl(rawUrl);
    if (!normalizedUrl) {
        return null;
    }

    const url = new URL(normalizedUrl);
    const pathname = url.pathname;

    let groupRef = fallbackGroupRef || null;
    let postId = null;

    let match = pathname.match(/^\/groups\/([^/?#]+)\/posts\/([^/?#]+)/i);
    if (match) {
        groupRef = match[1];
        postId = match[2];
    }

    if (!postId) {
        match = pathname.match(/^\/groups\/([^/?#]+)\/permalink\/([^/?#]+)/i);
        if (match) {
            groupRef = match[1];
            postId = match[2];
        }
    }

    if (!postId && /^\/(?:story|permalink)\.php$/i.test(pathname)) {
        postId = url.searchParams.get('story_fbid') || url.searchParams.get('fbid');
        groupRef = url.searchParams.get('id') || groupRef;
    }

    if (!postId && /^\/groups\/[^/?#]+\/?$/i.test(pathname)) {
        match = pathname.match(/^\/groups\/([^/?#]+)/i);
        if (match) {
            groupRef = match[1];
            postId = url.searchParams.get('multi_permalinks');
        }
    }

    if (!postId && /^\/groups\/[^/?#]+\/?$/i.test(pathname)) {
        postId = url.searchParams.get('view') === 'permalink'
            ? (url.searchParams.get('story_fbid') || url.searchParams.get('fbid'))
            : null;
    }

    const canonicalUrl = postId
        ? buildCanonicalGroupPostUrl(groupRef || fallbackGroupRef, postId) || normalizedUrl
        : normalizedUrl;

    return {
        groupRef: groupRef || fallbackGroupRef || null,
        postId: postId || null,
        canonicalUrl
    };
}

function chooseBestReference(links, fallbackGroupRef) {
    const ranked = [];

    for (const rawUrl of links) {
        const reference = extractPostReferenceFromUrl(rawUrl, fallbackGroupRef);
        if (!reference) {
            continue;
        }

        let rank = 0;
        if (reference.postId) {
            rank += 100;
        }
        if (reference.groupRef && reference.groupRef === fallbackGroupRef) {
            rank += 10;
        }
        if ((reference.canonicalUrl || '').includes('/groups/')) {
            rank += 5;
        }

        ranked.push({ rank, reference });
    }

    ranked.sort((left, right) => right.rank - left.rank);
    return ranked[0]?.reference || null;
}

function buildPostRecord(candidate, index, fallbackGroupRef) {
    const links = Array.isArray(candidate.links) ? candidate.links : [];
    const bestReference = chooseBestReference(links, fallbackGroupRef);
    const textSnippet = squashWhitespace(candidate.text).slice(0, 500);
    const authorName = squashWhitespace(candidate.authorName).slice(0, 160);
    const publishedLabel = squashWhitespace(candidate.publishedLabel).slice(0, 160);

    const fingerprintSource = [
        bestReference?.canonicalUrl || '',
        authorName,
        publishedLabel,
        textSnippet
    ].filter(Boolean).join('|') || `scan-index:${index}`;

    const fingerprint = hashText(fingerprintSource);
    const postKey = bestReference?.postId ? `post:${bestReference.postId}` : `fingerprint:${fingerprint}`;

    return {
        postKey,
        postId: bestReference?.postId || null,
        canonicalUrl: bestReference?.canonicalUrl || null,
        groupRef: bestReference?.groupRef || fallbackGroupRef || null,
        fingerprint,
        authorName: authorName || null,
        publishedLabel: publishedLabel || null,
        snippet: textSnippet || null
    };
}

async function waitForFeed(page) {
    for (const selector of FEED_READY_SELECTORS) {
        const found = await page.waitForSelector(selector, { timeout: 7000 }).catch(() => null);
        if (found) {
            return true;
        }
    }

    return false;
}

async function primeFeed(page) {
    for (let i = 0; i < 3; i += 1) {
        await page.evaluate((offset) => window.scrollBy(0, offset), 900);
        await page.waitForTimeout(1200);
    }
}

async function extractGroupPosts(page, groupUrl) {
    const MAX_RETRIES = 2;
    const fallbackGroupRef = extractGroupRef(groupUrl);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        try {
            logger.debug(`Navigating to ${groupUrl} (attempt ${attempt + 1})`);

            await page.goto(groupUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });

            await waitForFeed(page);
            await primeFeed(page);

            const rawCandidates = await page.evaluate(() => {
                const uniqueElements = new Set();
                const selectors = [
                    'div[role="feed"] div[role="article"]',
                    'div[role="main"] div[role="article"]',
                    'div[aria-posinset]'
                ];

                for (const selector of selectors) {
                    for (const element of document.querySelectorAll(selector)) {
                        uniqueElements.add(element);
                    }
                }

                const candidates = [];

                for (const element of uniqueElements) {
                    const links = Array.from(element.querySelectorAll('a[href]'))
                        .map(anchor => anchor.href || anchor.getAttribute('href') || '')
                        .filter(Boolean);

                    const text = (element.innerText || '').trim();
                    if (!links.length && !text) {
                        continue;
                    }

                    const timeNode = element.querySelector('a[aria-label][href], a[href] time, time');
                    const possibleAuthorLinks = Array.from(element.querySelectorAll('h2 a[href], h3 a[href], strong a[href], a[role="link"]'));
                    const authorName = possibleAuthorLinks
                        .map(node => (node.textContent || '').trim())
                        .find(Boolean) || '';

                    candidates.push({
                        links,
                        text,
                        authorName,
                        publishedLabel: (timeNode?.getAttribute?.('aria-label') || timeNode?.textContent || '').trim()
                    });
                }

                return candidates;
            });

            const posts = [];
            const seenKeys = new Set();

            for (let index = 0; index < rawCandidates.length; index += 1) {
                const post = buildPostRecord(rawCandidates[index], index, fallbackGroupRef);
                if (!post.postKey || seenKeys.has(post.postKey)) {
                    continue;
                }

                // Skip elements that do not look like posts after normalization.
                if (!post.postId && !post.snippet) {
                    continue;
                }

                seenKeys.add(post.postKey);
                posts.push(post);
            }

            logger.debug(`Extracted ${posts.length} unique posts from ${groupUrl}.`);
            return posts;
        } catch (error) {
            logger.warn(`Scrape attempt ${attempt + 1} failed for ${groupUrl}: ${error.message}`);
            if (attempt === MAX_RETRIES) {
                logger.error(`All scrape retries failed for ${groupUrl}`);
                return [];
            }

            await page.waitForTimeout(3000);
        }
    }

    return [];
}

module.exports = {
    extractGroupPosts,
    extractGroupRef,
    extractPostReferenceFromUrl,
    normalizeFacebookUrl
};
