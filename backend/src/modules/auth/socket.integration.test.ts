import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import dotenv from "dotenv";
dotenv.config();
// Reuse the existing mobile client dependency; this test does not add a client package.
const mobileRequire = createRequire(resolve("../mobile/package.json"));
type TestSocket = {
  once: (event: string, fn: (...args: unknown[]) => void) => void;
  emit: (event: string, data: unknown) => void;
  disconnect: () => void;
  connected: boolean;
};
const { io: client } = mobileRequire("socket.io-client") as {
  io: (url: string, options: object) => TestSocket;
};
test(
  "Redis adapter delivers named-room events across instances and rejects revoked incoming packets",
  { skip: !process.env.REDIS_URL },
  async () => {
    const { db } = await import("../../shared/config/db.js"),
      original = db.query.bind(db);
    let active = true;
    const userId = randomUUID();
    db.query = (async () => ({
      rows: active ? [{ id: userId }] : [],
      rowCount: active ? 1 : 0,
    })) as unknown as typeof db.query;
    const { attachWebsocket } = await import("../../websocket/index.js");
    const { signAccessToken } = await import("./jwt.service.js");
    const { SOCKET_EVENTS } = await import("../../websocket/events.js");
    const a = createServer(),
      b = createServer();
    let first: Awaited<ReturnType<typeof attachWebsocket>> | undefined,
      second: typeof first,
      socket: TestSocket | undefined;
    try {
      first = await attachWebsocket(a);
      second = await attachWebsocket(b);
      await Promise.all([
        new Promise<void>((r) => a.listen(0, "127.0.0.1", r)),
        new Promise<void>((r) => b.listen(0, "127.0.0.1", r)),
      ]);
      socket = client(`http://127.0.0.1:${(a.address() as AddressInfo).port}`, {
        transports: ["websocket"],
        auth: { token: signAccessToken({ id: userId }) },
        reconnection: false,
      });
      await new Promise<void>((r, j) => {
        socket!.once("connect", () => r());
        socket!.once("connect_error", j);
        setTimeout(
          () => j(new Error("socket connect timed out")),
          3000,
        ).unref();
      });
      // fetchSockets is also a cross-instance adapter request and ensures the room is registered.
      const room = `user:${userId}`;
      assert.equal((await second.in(room).fetchSockets()).length, 1);
      const receipt = new Promise<unknown>((r, j) => {
        socket!.once(SOCKET_EVENTS.WALLET_UPDATED, r);
        setTimeout(
          () => j(new Error("cross-instance delivery timed out")),
          3000,
        ).unref();
      });
      second
        .to(room)
        .emit(SOCKET_EVENTS.WALLET_UPDATED, { test: "cross-instance" });
      assert.deepEqual(await receipt, { test: "cross-instance" });
      const serviceUpdate = new Promise<unknown>((done,reject) => {
        socket!.once(SOCKET_EVENTS.DRIVER_SERVICE_SETTINGS,done);
        setTimeout(() => reject(new Error('service settings delivery timed out')),3000).unref();
      });
      const { emitServiceSettingsChanged } = await import('../../websocket/notifications.js');
      // The registered emitter belongs to the second server; the driver is on the first.
      emitServiceSettingsChanged(userId);
      assert.equal(typeof (await serviceUpdate as {at:number}).at,'number');
      active = false;
      const disconnected = new Promise<void>((r, j) => {
        socket!.once("disconnect", () => r());
        setTimeout(() => j(new Error("idle revocation timed out")), 5500).unref();
      });
      // No incoming packet: receive-only revoked clients must be disconnected.
      await disconnected;
      assert.equal((await second.in(room).fetchSockets()).length,0);
      active=true;
      const {env}=await import('../../config/env.js');
      const expiry=env.JWT_ACCESS_EXPIRY;
      Object.assign(env,{JWT_ACCESS_EXPIRY:'1s'});
      try {
        socket=client(`http://127.0.0.1:${(a.address() as AddressInfo).port}`,{transports:['websocket'],auth:{token:signAccessToken({id:userId})},reconnection:false});
        await new Promise<void>((done,reject)=>{socket!.once('connect',()=>done());socket!.once('connect_error',reject);});
        await new Promise<void>((done,reject)=>{socket!.once('disconnect',()=>done());setTimeout(()=>reject(new Error('idle expired socket remained connected')),2000).unref();});
        assert.equal(socket.connected,false);
        assert.equal((await second.in(room).fetchSockets()).length,0);
      } finally {Object.assign(env,{JWT_ACCESS_EXPIRY:expiry});}
    } finally {
      socket?.disconnect();
      await Promise.all([
        first
          ? new Promise<void>((r) => first!.close(() => r()))
          : Promise.resolve(),
        second
          ? new Promise<void>((r) => second!.close(() => r()))
          : Promise.resolve(),
      ]);
      db.query = original;
      const { redis } = await import("../../shared/config/redis.js");
      redis?.disconnect();
      await db.end();
    }
  },
);
