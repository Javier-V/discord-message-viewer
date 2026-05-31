const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Store messages data
let messagesData = [];
let connectedClients = 0;

// Initialize Discord client
const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

discordClient.once('ready', () => {
  console.log(`Discord bot logged in as ${discordClient.user.tag}!`);
});

// Handle Discord messages
discordClient.on('messageCreate', (message) => {
  if (message.author.bot) return;

  const messageData = {
    id: message.id,
    content: message.content,
    author: {
      id: message.author.id,
      username: message.author.username,
      discriminator: message.author.discriminator,
      avatar: message.author.displayAvatarURL(),
    },
    channelId: message.channel.id,
    guildId: message.guild?.id,
    timestamp: message.createdTimestamp,
    createdAt: message.createdAt,
  };

  // Store in memory
  messagesData.push(messageData);
  
  // Sort by timestamp (newest first)
  messagesData.sort((a, b) => b.timestamp - a.timestamp);
  
  // Limit to 500 messages
  if (messagesData.length > 500) {
    messagesData = messagesData.slice(0, 500);
  }
  
  // Broadcast to connected clients
  io.emit('messageUpdate', messageData);
});

// Function to fetch historical messages from channel
async function fetchHistoricalMessages(channelId) {
  try {
    const channel = discordClient.channels.cache.get(channelId);
    if (!channel || !channel.messages) return [];
    
    // Get the last 100 messages from the channel (max allowed by Discord API)
    const messages = await channel.messages.fetch({ limit: 100 });
    const messageArray = Array.from(messages.values());
    
    return messageArray.map(msg => ({
      id: msg.id,
      content: msg.content,
      author: {
        id: msg.author.id,
        username: msg.author.username,
        discriminator: msg.author.discriminator,
        avatar: msg.author.displayAvatarURL(),
      },
      channelId: msg.channel.id,
      guildId: msg.guild?.id,
      timestamp: msg.createdTimestamp,
      createdAt: msg.createdAt,
    }));
  } catch (error) {
    console.error('Error fetching historical messages:', error);
    return [];
  }
}

// Connect to Discord
discordClient.login(process.env.DISCORD_TOKEN);

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to get messages
app.get('/api/messages', async (req, res) => {
  const { search, sortBy, limit = 50, channelId } = req.query;
  
  let filteredMessages = [...messagesData];
  
  // If a specific channel is requested, fetch historical messages from that channel
  if (channelId && !req.query.skipHistorical) {
    try {
      // Fetch historical messages for specified channel
      const historicalMessages = await fetchHistoricalMessages(channelId);
      // Combine with existing messages
      filteredMessages = [...historicalMessages, ...messagesData];
      
      // Remove duplicates based on ID
      const seen = new Set();
      filteredMessages = filteredMessages.filter(msg => {
        if (seen.has(msg.id)) {
          return false;
        }
        seen.add(msg.id);
        return true;
      });
    } catch (error) {
      console.error('Error fetching historical messages:', error);
    }
  }
  
  // Apply search filter
  if (search) {
    const searchTerm = search.toLowerCase();
    filteredMessages = filteredMessages.filter(msg => 
      msg.content.toLowerCase().includes(searchTerm) ||
      msg.author.username.toLowerCase().includes(searchTerm)
    );
  }
  
  // Apply sorting
  if (sortBy) {
    if (sortBy === 'author') {
      filteredMessages.sort((a, b) => a.author.username.localeCompare(b.author.username));
    } else if (sortBy === 'date') {
      filteredMessages.sort((a, b) => b.timestamp - a.timestamp);
    }
  }
  
  // Apply limit
  filteredMessages = filteredMessages.slice(0, parseInt(limit));
  
  res.json(filteredMessages);
});

// WebSocket connection
io.on('connection', (socket) => {
  connectedClients++;
  console.log(`Client connected. Total clients: ${connectedClients}`);
  
  // Send current messages to new client
  socket.emit('initialMessages', messagesData);
  
  socket.on('disconnect', () => {
    connectedClients--;
    console.log(`Client disconnected. Total clients: ${connectedClients}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});