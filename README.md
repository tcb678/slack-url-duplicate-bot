# Slack URL Duplicate Detection Bot

A Slack bot that automatically detects and marks duplicate URLs shared in channels within the last 24 hours.

## What It Does

- **Monitors channels** for URL sharing
- **Detects duplicates** within 24 hours
- **Marks duplicates** with a `:repeat:` emoji
- **Smart URL matching** - treats `https://example.com/page?ref=123` and `example.com/page` as the same
- **Manual scanning** with `@bot check duplicates`

## Setup

### 1. Install Dependencies
```bash
npm install @slack/bolt dotenv
```

### 2. Create Slack App
1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. **Create New App** → **From an app manifest**
3. Paste this manifest:

```yaml
display_information:
  name: URL Duplicate Detector
  description: Automatically detects and marks duplicate URLs shared in channels
features:
  bot_user:
    display_name: url-duplicate-bot
    always_online: false
  slash_commands:
    - command: /check-duplicates
      description: Scan current channel for duplicate URLs
oauth_config:
  scopes:
    bot:
      - channels:history
      - reactions:write
      - chat:write
      - commands
      - app_mentions:read
settings:
  event_subscriptions:
    bot_events:
      - message.channels
      - app_mention
  socket_mode_enabled: true
```

### 3. Get Your Tokens
- **Bot Token**: OAuth & Permissions → Install to Workspace → Copy the `xoxb-` token
- **App Token**: Basic Information → App-Level Tokens → Generate Token with `connections:write` scope
- **Signing Secret**: Basic Information → Copy signing secret

### 4. Create .env File
```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token  
SLACK_SIGNING_SECRET=your-signing-secret
PORT=3000
```

### 5. Run It
```bash
node bot.js
```

## Usage

1. **Add bot to channel**: `/invite @url-duplicate-bot`
2. **Share URLs** - duplicates get marked automatically
3. **Manual scan**: `@bot check duplicates`
4. **Check stats**: `@bot cache stats`

## How It Works

- Extracts URLs from messages using regex
- Normalizes URLs (removes protocols, query params, etc.)
- Caches URLs for 24 hours
- Marks duplicates with emoji reactions
- Auto-cleans old cache entries

## Configuration

Edit these values in `bot.js`:

```javascript
const DUPLICATE_EMOJI = 'repeat';   // Change the emoji
const CHECK_HOURS = 24;             // Change time window
```

## Troubleshooting

**Bot not responding?**
- Check Socket Mode is enabled
- Verify tokens are correct
- Make sure bot is in the channel

**Permission errors?**
- Reinstall app after changing scopes
- Check OAuth permissions match the manifest
