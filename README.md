# Discord Message Viewer

A web-based viewer for Discord messages with search and sorting capabilities.

## Features

- View messages from Discord channels
- Search by author name or message content
- Sort by date (newest first) or author
- Real-time updates via WebSocket
- Historical message retrieval (with proper permissions)
- Responsive web interface

## Requirements

- Node.js 16 or higher
- A Discord bot with MESSAGE_CONTENT and GUILD_MESSAGES intents enabled
- Discord server with the bot added and proper permissions

## Setup Instructions

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```

3. Create a Discord bot at https://discord.com/developers/applications

4. Enable the following intents in your bot settings:
   - GUILD_MESSAGES
   - MESSAGE_CONTENT

5. Add your bot to your Discord server

6. Set your bot token as an environment variable:
   ```
   export DISCORD_TOKEN="your-bot-token-here"
   ```

7. Start the server:
   ```
   npm start
   ```

8. Visit `http://localhost:3000` to view messages

## Usage

- Search bar: Filter messages by author name or content
- Sort dropdown: Change sorting between date and author
- Refresh button: Reload messages from Discord
- Historical messages are automatically fetched when viewing specific channels

## API Endpoints

- `GET /api/messages` - Get filtered messages (supports search, sort, and channel parameters)
- `GET /api/messages?channelId={channel_id}&limit=50` - Get messages from a specific channel with pagination

## Files

- `web-server.js` - Main web server with Express and Socket.IO
- `public/` - Web interface files (HTML, CSS, JavaScript)

## Permissions Required

For historical message access, your bot needs the following permissions in the server:
- VIEW_CHANNEL
- READ_MESSAGE_HISTORY

## How It Works

1. **Live Messages**: The bot receives real-time messages as they are sent (via GUILD_MESSAGES intent)
2. **Historical Messages**: When viewing a specific channel, the application fetches recent messages from that channel via Discord's API
3. **Search & Sort**: All messages (live and historical) can be searched and sorted

## Important Notes

- The GUILD_MESSAGE_HISTORY intent is **not available** in Test Mode for applications with <100 servers
- To access historical messages, your application must be verified with Discord (100+ servers)
- The current implementation works for future messages and can fetch recent messages from channels

## License

MIT