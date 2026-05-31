const fs = require('fs/promises');
const path = require('path');

class ActivityStore {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.eventsFile = path.join(dataDir, 'voice-events.json');
    this.sessionsFile = path.join(dataDir, 'voice-sessions.json');
    this.events = [];
    this.sessions = [];
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    this.events = await this.readJsonArray(this.eventsFile);
    this.sessions = await this.readJsonArray(this.sessionsFile);
  }

  async readJsonArray(filePath) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async writeJsonAtomic(filePath, value) {
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(tmpPath, filePath);
  }

  getEvents() {
    return [...this.events];
  }

  getSessions() {
    return [...this.sessions];
  }

  getOpenSession(userId) {
    return this.sessions.find((session) => session.userId === userId && !session.leftAt);
  }

  async recordVoiceTransition({ oldState, newState, timestamp = new Date() }) {
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    if (oldChannelId === newChannelId) return null;

    const now = timestamp.toISOString();
    const userSnapshot = createUserSnapshot(newState.member || oldState.member, newState.id || oldState.id);
    const events = [];

    if (oldChannelId && newChannelId) {
      await this.closeOpenSession({
        userId: userSnapshot.id,
        leftAt: now,
        endedBy: 'move',
        nextChannelId: newChannelId,
      });
      await this.openSession({
        userSnapshot,
        channelSnapshot: createChannelSnapshot(newState.channel, newChannelId),
        joinedAt: now,
        startedBy: 'move',
      });

      events.push(createVoiceEvent('move', now, userSnapshot, {
        fromChannel: createChannelSnapshot(oldState.channel, oldChannelId),
        toChannel: createChannelSnapshot(newState.channel, newChannelId),
      }));
    } else if (newChannelId) {
      await this.openSession({
        userSnapshot,
        channelSnapshot: createChannelSnapshot(newState.channel, newChannelId),
        joinedAt: now,
        startedBy: 'join',
      });

      events.push(createVoiceEvent('join', now, userSnapshot, {
        toChannel: createChannelSnapshot(newState.channel, newChannelId),
      }));
    } else if (oldChannelId) {
      await this.closeOpenSession({
        userId: userSnapshot.id,
        leftAt: now,
        endedBy: 'leave',
      });

      events.push(createVoiceEvent('leave', now, userSnapshot, {
        fromChannel: createChannelSnapshot(oldState.channel, oldChannelId),
      }));
    }

    if (events.length > 0) {
      this.events.push(...events);
      await this.persist();
    }

    return events;
  }

  async reconcileActiveVoiceStates(activeStates, timestamp = new Date()) {
    const now = timestamp.toISOString();
    const activeByUser = new Map(activeStates.map((state) => [state.userId, state]));
    const changedEvents = [];

    for (const session of this.sessions.filter((item) => !item.leftAt)) {
      const activeState = activeByUser.get(session.userId);

      if (!activeState) {
        session.leftAt = now;
        session.durationMs = new Date(now).getTime() - new Date(session.joinedAt).getTime();
        session.endedBy = 'startup_reconcile';
        session.approximate = true;
        changedEvents.push(createVoiceEvent('leave', now, session.user, {
          fromChannel: session.channel,
          approximate: true,
        }));
      } else if (activeState.channel.id !== session.channelId) {
        session.leftAt = now;
        session.durationMs = new Date(now).getTime() - new Date(session.joinedAt).getTime();
        session.endedBy = 'startup_reconcile';
        session.approximate = true;
        changedEvents.push(createVoiceEvent('move', now, session.user, {
          fromChannel: session.channel,
          toChannel: activeState.channel,
          approximate: true,
        }));

        this.sessions.push(createSession({
          userSnapshot: activeState.user,
          channelSnapshot: activeState.channel,
          joinedAt: now,
          startedBy: 'startup_reconcile',
          approximate: true,
        }));
      }
    }

    const openUsers = new Set(this.sessions.filter((session) => !session.leftAt).map((session) => session.userId));

    for (const activeState of activeStates) {
      if (openUsers.has(activeState.userId)) continue;

      this.sessions.push(createSession({
        userSnapshot: activeState.user,
        channelSnapshot: activeState.channel,
        joinedAt: now,
        startedBy: 'startup_reconcile',
        approximate: true,
      }));
      changedEvents.push(createVoiceEvent('join', now, activeState.user, {
        toChannel: activeState.channel,
        approximate: true,
      }));
    }

    if (changedEvents.length > 0) {
      this.events.push(...changedEvents);
      await this.persist();
    }

    return changedEvents;
  }

  async openSession({ userSnapshot, channelSnapshot, joinedAt, startedBy, approximate = false }) {
    const existing = this.getOpenSession(userSnapshot.id);

    if (existing) {
      existing.leftAt = joinedAt;
      existing.durationMs = new Date(joinedAt).getTime() - new Date(existing.joinedAt).getTime();
      existing.endedBy = 'implicit_close';
    }

    this.sessions.push(createSession({
      userSnapshot,
      channelSnapshot,
      joinedAt,
      startedBy,
      approximate,
    }));
  }

  async closeOpenSession({ userId, leftAt, endedBy, nextChannelId = null }) {
    const session = this.getOpenSession(userId);
    if (!session) return null;

    session.leftAt = leftAt;
    session.durationMs = new Date(leftAt).getTime() - new Date(session.joinedAt).getTime();
    session.endedBy = endedBy;
    if (nextChannelId) session.nextChannelId = nextChannelId;

    return session;
  }

  async persist() {
    await this.writeJsonAtomic(this.eventsFile, this.events);
    await this.writeJsonAtomic(this.sessionsFile, this.sessions);
  }
}

function createSession({ userSnapshot, channelSnapshot, joinedAt, startedBy, approximate = false }) {
  return {
    id: `${userSnapshot.id}-${channelSnapshot.id}-${new Date(joinedAt).getTime()}`,
    userId: userSnapshot.id,
    channelId: channelSnapshot.id,
    user: userSnapshot,
    channel: channelSnapshot,
    joinedAt,
    leftAt: null,
    durationMs: null,
    startedBy,
    endedBy: null,
    approximate,
  };
}

function createVoiceEvent(type, timestamp, userSnapshot, extra = {}) {
  return {
    id: `${type}-${userSnapshot.id}-${new Date(timestamp).getTime()}`,
    type,
    timestamp,
    userId: userSnapshot.id,
    user: userSnapshot,
    ...extra,
  };
}

function createUserSnapshot(member, fallbackId) {
  const user = member?.user || member;

  return {
    id: user?.id || fallbackId || null,
    username: user?.username || 'unknown',
    displayName: member?.displayName || user?.globalName || user?.username || 'Unknown user',
    tag: user?.tag || user?.username || 'unknown',
    avatar: user?.displayAvatarURL ? user.displayAvatarURL({ extension: 'png', size: 64 }) : null,
    bot: Boolean(user?.bot),
  };
}

function createChannelSnapshot(channel, fallbackId) {
  return {
    id: channel?.id || fallbackId || null,
    name: channel?.name || fallbackId || 'Unknown channel',
    type: channel?.type ?? null,
    guildId: channel?.guildId || channel?.guild?.id || null,
  };
}

module.exports = {
  ActivityStore,
  createChannelSnapshot,
  createUserSnapshot,
};
