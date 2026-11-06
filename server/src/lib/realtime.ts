/**
 * Thin indirection over Socket.io so services can publish realtime updates
 * without depending on the socket server (and so tests can run without it).
 */
import type { Server } from 'socket.io';

let io: Server | null = null;

export function attachRealtime(server: Server): void {
  io = server;
}

export function detachRealtime(): void {
  io = null;
}

type Id = { toString(): string };

export const rooms = {
  user: (userId: Id) => `user:${userId}`,
  event: (eventId: Id) => `event:${eventId}`,
  /** The event id in an event room's name, or null for other rooms. */
  eventIdOf: (room: string) => (room.startsWith('event:') ? room.slice('event:'.length) : null),
};

export function emitToUser(userId: Id, eventName: string, payload: unknown): void {
  io?.to(rooms.user(String(userId))).emit(eventName, payload);
}

export function emitToEvent(eventId: Id, eventName: string, payload: unknown): void {
  io?.to(rooms.event(String(eventId))).emit(eventName, payload);
}
