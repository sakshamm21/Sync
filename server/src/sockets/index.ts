import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import env from '../config/env';
import logger from '../lib/logger';
import { attachRealtime, rooms } from '../lib/realtime';
import { resolveUserFromToken } from '../middleware/auth';
import * as chat from '../modules/chat/chat.service';
import type { UserDocument } from '../models';

/** Typing pings a client may send per room, at most one per this long. */
const TYPING_GAP_MS = 1500;
/** How often a socket re-checks it may still be in each chat it joined. */
const RECHECK_MS = 60_000;

type Ack = (result: { ok: true } | { ok: false; error: { code: string; message: string } }) => void;

/**
 * Socket.io is receive-only for clients: they send messages over REST (one
 * place for validation and permissions) and get pushes here:
 *   - `notification:new`  in their personal room
 *   - `message:new`, `event:typing`  in event rooms they joined
 */
export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigins.includes('*') ? true : env.clientOrigins, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      socket.data.user = await resolveUserFromToken(socket.handshake.auth?.token);
      next();
    } catch (err) {
      const { message, code } = err as { message?: string; code?: string };
      const error = new Error(message || 'Unauthorized') as Error & { data?: unknown };
      error.data = { code: code || 'UNAUTHENTICATED' };
      next(error);
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as UserDocument;
    void socket.join(rooms.user(user.id));

    socket.on('event:join', async (eventId: unknown, ack: Ack = () => {}) => {
      try {
        await chat.findChatEvent(user, String(eventId));
        await socket.join(rooms.event(String(eventId)));
        ack({ ok: true });
      } catch (err) {
        const { message, code } = err as { message?: string; code?: string };
        ack({ ok: false, error: { code: code || 'CHAT_FORBIDDEN', message: message || 'Cannot join this chat' } });
      }
    });

    socket.on('event:leave', (eventId: unknown) => {
      void socket.leave(rooms.event(String(eventId)));
    });

    const lastTyping = new Map<string, number>();
    socket.on('event:typing', (eventId: unknown) => {
      const room = rooms.event(String(eventId));
      if (!socket.rooms.has(room)) return;
      // Throttled on the server too, so a misbehaving client can't flood a room.
      const now = Date.now();
      if (now - (lastTyping.get(room) ?? 0) < TYPING_GAP_MS) return;
      lastTyping.set(room, now);
      socket.to(room).emit('event:typing', { eventId: String(eventId), user: { id: user.id, name: user.name } });
    });

    // Someone who leaves an event, is removed from its team or is suspended
    // stops receiving its chat: membership is re-checked every minute.
    const recheck = setInterval(async () => {
      try {
        const fresh = await resolveUserFromToken(socket.handshake.auth?.token);
        for (const room of socket.rooms) {
          const eventId = rooms.eventIdOf(room);
          if (!eventId) continue;
          await chat.findChatEvent(fresh, eventId).catch(() => socket.leave(room));
        }
      } catch {
        socket.disconnect(true);
      }
    }, RECHECK_MS);
    recheck.unref();
    socket.on('disconnect', () => clearInterval(recheck));
  });

  io.engine.on('connection_error', (err: Error) => logger.debug({ err: err.message }, 'Socket connection error'));

  attachRealtime(io);
  return io;
}
