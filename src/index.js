import { DurableObject } from "cloudflare:workers";

// One Room per URL path. It holds who has control, the controller's deck state,
// and the shared timer, and relays them to everyone connected over WebSockets.
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.data = (await this.ctx.storage.get("data")) || { controller: null, state: null, timer: null };
    });
  }

  async fetch() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  ids(except) {
    const set = new Set();
    for (const w of this.ctx.getWebSockets()) {
      if (w === except) continue;
      const a = w.deserializeAttachment();
      if (a && a.id) set.add(a.id);
    }
    return set;
  }

  roomMsg(except) {
    return { t: "room", controller: this.data.controller, peers: this.ids(except).size, now: Date.now() };
  }

  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const w of this.ctx.getWebSockets()) {
      if (w === except) continue;
      try { w.send(s); } catch (e) {}
    }
  }

  async save() { await this.ctx.storage.put("data", this.data); }

  async dropMissingController(closing) {
    if (this.data.controller && !this.ids(closing).has(this.data.controller)) {
      this.data.controller = null;
      await this.save();
    }
  }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    const now = Date.now();

    if (m.t === "hello") {
      const id = String(m.id || "").slice(0, 40);
      if (!id) return;
      ws.serializeAttachment({ id });
      await this.dropMissingController();
      ws.send(JSON.stringify({
        t: "welcome", you: id, echo: m.sent, now,
        state: this.data.state, timer: this.data.timer,
        controller: this.data.controller, peers: this.ids().size,
      }));
      this.broadcast(this.roomMsg());
      return;
    }

    const att = ws.deserializeAttachment();
    const id = att && att.id;
    if (!id) return;

    if (m.t === "ping") { ws.send(JSON.stringify({ t: "pong", echo: m.sent, now })); return; }

    if (m.t === "take") {
      this.data.controller = id;
      await this.save();
      this.broadcast(this.roomMsg());
      return;
    }
    if (m.t === "release") {
      if (this.data.controller === id) { this.data.controller = null; await this.save(); this.broadcast(this.roomMsg()); }
      return;
    }

    // Only the controller (or anyone, when nobody has control) can change state or the timer.
    if (this.data.controller && this.data.controller !== id) return;

    if (m.t === "state" && m.state && typeof m.state === "object") {
      this.data.state = m.state;
      const t = this.data.timer;
      if (t && typeof m.state.slide === "number" && m.state.slide !== t.slideIdx) {
        t.slideIdx = m.state.slide;
        t.slideElapsed = 0;
        t.slideSince = t.running ? now : null;
        this.broadcast({ t: "timer", timer: t, now });
      }
      await this.save();
      this.broadcast({ t: "state", state: m.state, now }, ws);
      return;
    }

    if (m.t === "timer") {
      let t = this.data.timer;
      if (m.action === "config") {
        const total = Math.round(+m.total || 0);
        if (!(total >= 60000 && total <= 6 * 3600000)) return;
        t = {
          total, slides: Math.max(1, Math.min(200, Math.round(+m.slides || 1))),
          running: false, elapsed: 0, since: null,
          slideIdx: (this.data.state && this.data.state.slide) || 0, slideElapsed: 0, slideSince: null,
        };
      } else if (!t) {
        return;
      } else if (m.action === "start" && !t.running) {
        t.running = true; t.since = now; t.slideSince = now;
      } else if (m.action === "pause" && t.running) {
        t.elapsed += now - t.since; t.slideElapsed += now - t.slideSince;
        t.running = false; t.since = null; t.slideSince = null;
      } else if (m.action === "reset") {
        t.running = false; t.elapsed = 0; t.since = null; t.slideElapsed = 0; t.slideSince = null;
      } else if (m.action === "clear") {
        t = null;
      }
      this.data.timer = t;
      await this.save();
      this.broadcast({ t: "timer", timer: t, now });
    }
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, "closing"); } catch (e) {}
    await this.dropMissingController(ws);
    this.broadcast(this.roomMsg(ws), ws);
  }

  async webSocketError(ws) { await this.webSocketClose(ws, 1011); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/ws/")) {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      const name = decodeURIComponent(url.pathname.slice(4)).slice(0, 200) || "_root";
      return env.ROOM.get(env.ROOM.idFromName(name)).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
