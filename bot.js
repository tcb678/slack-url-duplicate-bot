const { App } = require('@slack/bolt');
require('dotenv').config();

// Initialize Slack app with Bolt framework
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true, // Enable socket mode for easier development
  appToken: process.env.SLACK_APP_TOKEN, // Required for socket mode
  port: process.env.PORT || 3000
});

// Configuration
const DUPLICATE_EMOJI = 'repeat'; // Emoji to mark duplicates
const CHECK_HOURS = 24; // Hours to look back for duplicates

// In-memory cache for URLs (in production, use Redis or database)
const urlCache = new Map(); // Structure: url -> { channels: Set, timestamps: [timestamp, ...] }

// Clean old URLs from cache periodically
setInterval(() => {
  const cutoffTime = Date.now() - (CHECK_HOURS * 60 * 60 * 1000);
  
  for (const [url, data] of urlCache.entries()) {
    // Filter out old timestamps
    data.timestamps = data.timestamps.filter(ts => ts >= cutoffTime);
    
    // Remove URL entirely if no recent timestamps
    if (data.timestamps.length === 0) {
      urlCache.delete(url);
    }
  }
}, 60 * 60 * 1000); // Clean every hour

// Extract URLs from message text
function extractUrls(text) {
  if (!text) return [];
  
  // Regex to match URLs (http/https, www, or domain.com patterns)
  const urlRegex = /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9][-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&=]*)/gi;
  
  const urls = text.match(urlRegex) || [];
  
  // Normalize URLs (remove protocol, www, trailing slashes, etc.)
  return urls.map(url => {
    let normalized = url.toLowerCase();
    normalized = normalized.replace(/^https?:\/\//, '');
    normalized = normalized.replace(/^www\./, '');
    normalized = normalized.replace(/\/$/, '');
    normalized = normalized.replace(/\?.*$/, ''); // Remove query parameters
    normalized = normalized.replace(/#.*$/, ''); // Remove fragments
    return normalized;
  }).filter(url => url.length > 0);
}

// Check if any URLs in the message are duplicates
function checkForDuplicateUrls(channelId, urls, timestamp) {
  const duplicateUrls = [];
  const cutoffTime = timestamp - (CHECK_HOURS * 60 * 60 * 1000);
  
  for (const url of urls) {
    const urlData = urlCache.get(url);
    
    if (urlData) {
      // Check if this URL was posted in the same channel within the time window
      const recentTimestamps = urlData.timestamps.filter(ts => 
        ts >= cutoffTime && ts < timestamp
      );
      
      if (recentTimestamps.length > 0 && urlData.channels.has(channelId)) {
        duplicateUrls.push(url);
      }
    }
  }
  
  return duplicateUrls;
}

// Add URLs to cache
function addUrlsToCache(channelId, urls, timestamp) {
  for (const url of urls) {
    if (!urlCache.has(url)) {
      urlCache.set(url, {
        channels: new Set(),
        timestamps: []
      });
    }
    
    const urlData = urlCache.get(url);
    urlData.channels.add(channelId);
    urlData.timestamps.push(timestamp);
    
    // Keep only recent timestamps to prevent memory bloat
    const cutoffTime = timestamp - (CHECK_HOURS * 60 * 60 * 1000);
    urlData.timestamps = urlData.timestamps.filter(ts => ts >= cutoffTime);
  }
}

// Mark message as duplicate
async function markAsDuplicate(channelId, messageTs, duplicateUrls) {
  try {
    await app.client.reactions.add({
      channel: channelId,
      timestamp: messageTs,
      name: DUPLICATE_EMOJI
    });
    console.log(`Marked message as duplicate (URLs: ${duplicateUrls.join(', ')}): ${channelId}/${messageTs}`);
  } catch (error) {
    console.error('Error adding reaction:', error);
  }
}

// Listen for messages in channels
app.message(async ({ message, client }) => {
  // Skip bot messages, threaded replies, and message edits
  if (message.bot_id || message.thread_ts || message.subtype) {
    return;
  }

  const { channel, text, ts, user } = message;
  
  if (!text || !channel || !ts) {
    return;
  }

  const timestamp = parseFloat(ts) * 1000; // Convert to milliseconds
  const urls = extractUrls(text);
  
  // Skip if no URLs found
  if (urls.length === 0) {
    return;
  }
  
  // Check if any URLs are duplicates
  const duplicateUrls = checkForDuplicateUrls(channel, urls, timestamp);
  
  if (duplicateUrls.length > 0) {
    await markAsDuplicate(channel, ts, duplicateUrls);
  }
  
  // Add URLs to cache for future comparisons
  addUrlsToCache(channel, urls, timestamp);
});

// Handle app mentions for manual duplicate checking
app.event('app_mention', async ({ event, client }) => {
  const { channel, text, ts } = event;
  
  if (text.includes('check duplicates') || text.includes('scan duplicates')) {
    try {
      const duplicateCount = await scanChannelForDuplicates(channel, client);
      await client.chat.postMessage({
        channel: channel,
        thread_ts: ts,
        text: `🔍 Finished scanning for duplicate URLs in this channel! Found ${duplicateCount} duplicates.`
      });
    } catch (error) {
      console.error('Error during manual scan:', error);
      await client.chat.postMessage({
        channel: channel,
        thread_ts: ts,
        text: `❌ Error occurred while scanning for duplicates.`
      });
    }
  } else if (text.includes('cache stats')) {
    const stats = getCacheStats();
    await client.chat.postMessage({
      channel: channel,
      thread_ts: ts,
      text: `📊 Cache Stats:\n• ${stats.totalUrls} unique URLs tracked\n• ${stats.totalEntries} total entries\n• Memory usage: ~${stats.memoryEstimate}KB`
    });
  }
});

// Slash command for duplicate checking
app.command('/check-duplicates', async ({ command, ack, respond, client }) => {
  await ack();
  
  try {
    const duplicateCount = await scanChannelForDuplicates(command.channel_id, client);
    await respond({
      text: `🔍 Finished scanning for duplicate URLs in this channel! Found ${duplicateCount} duplicates.`,
      response_type: 'ephemeral'
    });
  } catch (error) {
    console.error('Error during slash command scan:', error);
    await respond({
      text: `❌ Error occurred while scanning for duplicates.`,
      response_type: 'ephemeral'
    });
  }
});

// Get cache statistics
function getCacheStats() {
  const totalUrls = urlCache.size;
  const totalEntries = Array.from(urlCache.values()).reduce((sum, data) => sum + data.timestamps.length, 0);
  const memoryEstimate = Math.round((totalUrls * 100 + totalEntries * 20) / 1024); // Rough estimate in KB
  
  return { totalUrls, totalEntries, memoryEstimate };
}

// Manual scan function for existing messages
async function scanChannelForDuplicates(channelId, client) {
  const cutoffTime = (Date.now() - (CHECK_HOURS * 60 * 60 * 1000)) / 1000;
  let duplicateCount = 0;
  
  try {
    // Get recent messages from the channel
    const result = await client.conversations.history({
      channel: channelId,
      oldest: cutoffTime.toString(),
      limit: 1000
    });
    
    const messages = result.messages.reverse(); // Process in chronological order
    const seenUrls = new Map(); // url -> first message timestamp
    
    for (const message of messages) {
      if (message.bot_id || message.thread_ts || message.subtype || !message.text) {
        continue;
      }
      
      const urls = extractUrls(message.text);
      
      if (urls.length > 0) {
        const duplicateUrls = [];
        
        for (const url of urls) {
          if (seenUrls.has(url)) {
            duplicateUrls.push(url);
          } else {
            seenUrls.set(url, message.ts);
          }
        }
        
        if (duplicateUrls.length > 0) {
          await markAsDuplicate(channelId, message.ts, duplicateUrls);
          duplicateCount++;
        }
        
        // Add to cache
        const timestamp = parseFloat(message.ts) * 1000;
        addUrlsToCache(channelId, urls, timestamp);
      }
    }
    
    return duplicateCount;
    
  } catch (error) {
    console.error('Error scanning channel:', error);
    throw error;
  }
}

// Handle errors
app.error((error) => {
  console.error('Slack Bolt error:', error);
});

// Start the app
(async () => {
  try {
    await app.start();
    console.log('🤖 Slack URL duplicate detection bot is running!');
    console.log(`🔗 Monitoring URLs and marking duplicates with :${DUPLICATE_EMOJI}:`);
    console.log(`⏰ Checking for duplicates within the last ${CHECK_HOURS} hours`);
    console.log('💡 Commands:');
    console.log('   • @bot check duplicates - Manual scan');
    console.log('   • @bot cache stats - View cache statistics');
    console.log('   • /check-duplicates - Slash command scan');
  } catch (error) {
    console.error('Failed to start app:', error);
  }
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down bot...');
  console.log(`Final cache stats: ${getCacheStats().totalUrls} URLs tracked`);
  await app.stop();
  process.exit(0);
});

module.exports = app;
