// WebSocket zum Server mit Heartbeat, Wiederverbinden und Antworten auf Anfragen.

import { ApiError } from "./api.js";

const PROTOCOL = 1;
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000];
const RECEIVE_TIMEOUT_MS = 12000;
const CLOSE_SESSION_EXPIRED = 4002;

export function createSocket(handlers) {
  let socket = null;
  let attempts = 0;
  let reconnectTimer = null;
  let watchTimer = null;
  let lastReceived = 0;
  let stopped = false;
  let nextRequest = 1;
  const pending = new Map();

  function rejectPending() {
    pending.forEach(({ reject }) => reject(new ApiError("offline")));
    pending.clear();
  }

  function transmit(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  function send(type, data) {
    return transmit({ type, data });
  }

  function request(type, data) {
    return new Promise((resolve, reject) => {
      const id = `c-${nextRequest}`;
      nextRequest += 1;
      if (!transmit({ type, id, data })) {
        reject(new ApiError("offline"));
        return;
      }
      pending.set(id, { resolve, reject });
    });
  }

  function receive(message) {
    if (message.type === "ping") {
      send("pong", { t: message.data.t });
    } else if (message.type === "ack" || message.type === "error") {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.type === "ack") waiting.resolve(message.data);
      else waiting.reject(new ApiError(message.data.code));
    } else if (message.type === "reload") {
      location.reload();
    } else {
      handlers.onMessage(message);
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer !== null) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(attempts, RECONNECT_DELAYS_MS.length - 1)];
    attempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    const scheme = location.protocol === "https:" ? "wss://" : "ws://";
    const current = new WebSocket(`${scheme}${location.host}/ws/admin`);
    socket = current;

    current.onopen = () => {
      lastReceived = Date.now();
      send("hello", { protocol: PROTOCOL });
      handlers.onOpen();
    };
    current.onmessage = (event) => {
      lastReceived = Date.now();
      attempts = 0;
      receive(JSON.parse(event.data));
    };
    current.onclose = (event) => {
      if (socket !== current) return;
      rejectPending();
      handlers.onClose();
      if (event.code === CLOSE_SESSION_EXPIRED) {
        stopped = true;
        handlers.onExpired();
        return;
      }
      scheduleReconnect();
    };
  }

  function start() {
    stopped = false;
    connect();
    watchTimer = setInterval(() => {
      const open = socket && socket.readyState === WebSocket.OPEN;
      if (open && Date.now() - lastReceived > RECEIVE_TIMEOUT_MS) socket.close();
    }, 1000);
  }

  function stop() {
    stopped = true;
    clearInterval(watchTimer);
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (socket) socket.close();
    socket = null;
    rejectPending();
  }

  return { start, stop, send, request };
}
