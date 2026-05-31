const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // This is required for accessing message content
    GatewayIntentBits.GuildMembers,
  ],
});

// Store messages
client.messages = new Collection();

// When the client is ready, run this code (only once)
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

// Handle message events
client.on('messageCreate', async (message) => {
  // Skip if it's a bot message
  if (message.author.bot) return;

  // Store message in collection
  const messageData = {
    id: message.id,
    content: message.content,
    author: {
      id: message.author.id,
      username: message.author.username,
      discriminator: message.author.discriminator,
      avatar: message.author.displayAvatarURL()
    },
    channelId: message.channel.id,
    guildId: message.guild?.id,
    timestamp: message.createdTimestamp,
    createdAt: message.createdAt,
  };

  // Add to messages collection
  client.messages.set(message.id, messageData);
  
  // Also store in a more accessible format
  const channelKey = message.channel.id;
  if (!client.messagesByChannel) client.messagesByChannel = new Collection();
  if (!client.messagesByChannel.has(channelKey)) {
    client.messagesByChannel.set(channelKey, []);
  }
  client.messagesByChannel.get(channelKey).push(messageData);
});

// Handle message updates
client.on('messageUpdate', (oldMessage, newMessage) => {
  if (newMessage.author?.bot) return;
  
  const messageData = {
    id: newMessage.id,
    content: newMessage.content,
    author: {
      id: newMessage.author.id,
      username: newMessage.author.username,
      discriminator: newMessage.author.discriminator,
      avatar: newMessage.author.displayAvatarURL()
    },
    channelId: newMessage.channel.id,
    guildId: newMessage.guild?.id,
    timestamp: newMessage.createdTimestamp,
    createdAt: newMessage.createdAt,
  };

  // Update in collection
  if (client.messages.has(newMessage.id)) {
    client.messages.set(newMessage.id, messageData);
  }
});

// Command to get messages
client.commands = new Collection();
client.commands.set('getmessages', {
  name: 'getmessages',
  description: 'Get messages from a channel',
  execute: async (message, args) => {
    if (!message.guild) return;
    
    // Get channel
    const channel = message.channel;
    const channelKey = channel.id;
    
    // Get messages from collection
    const messagesData = client.messagesByChannel.get(channelKey) || [];
    
    // Sort by timestamp (newest first)
    messagesData.sort((a, b) => b.timestamp - a.timestamp);
    
    // Create response
    let response = `Found ${messagesData.length} messages in ${channel.name}:\n\n`;
    
    messagesData.forEach(msg => {
      response += `**${msg.author.username}** - ${msg.createdAt.toLocaleString()}:\n${msg.content}\n\n`;
    });
    
    // Send response in chunks if too long
    const MAX_MESSAGE_LENGTH = 2000;
    if (response.length > MAX_MESSAGE_LENGTH) {
      const chunks = [];
      for (let i = 0; i < response.length; i += MAX_MESSAGE_LENGTH) {
        chunks.push(response.slice(i, i + MAX_MESSAGE_LENGTH));
      }
      
      chunks.forEach(chunk => {
        message.channel.send(chunk);
      });
    } else {
      message.channel.send(response);
    }
  }
});

// Handle commands
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const commandName = args.shift()?.toLowerCase();

  const command = client.commands.get(commandName);
  if (!command) return;

  try {
    await command.execute(message, args);
  } catch (error) {
    console.error(error);
    message.channel.send('There was an error executing this command!');
  }
});

// Login to Discord with your app's token
client.login(process.env.DISCORD_TOKEN);

// Export client for use in other modules
module.exports = client;