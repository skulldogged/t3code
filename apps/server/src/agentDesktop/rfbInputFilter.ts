/**
 * Reads the client half of a VNC (RFB 3.8) connection and forwards it, except
 * input from a viewer that hasn't taken control. Messages can split across
 * WebSocket frames, so this buffers until each one is whole. Anything it
 * doesn't recognise ends the connection rather than passing unchecked.
 *
 * @module rfbInputFilter
 */

const VERSION = "RFB 003.008\n";
const SECURITY_NONE = 1;

const KEY_EVENT = 4;
const POINTER_EVENT = 5;
const CLIENT_CUT_TEXT = 6;
const QEMU_MESSAGE = 255;
const QEMU_EXTENDED_KEY = 0;

export interface RfbInputFilter {
  /** Bytes from the viewer, in order. */
  readonly receive: (data: Uint8Array) => void;
  /** Lets go of keys and buttons this viewer still holds, when control moves. */
  readonly releaseHeldInput: () => void;
}

type Phase = "version" | "security" | "clientInit" | "messages";

/** The length of the whole message at the start of `buffer`, once enough is there to tell. */
const messageLength = (buffer: Uint8Array): number | "unknown" | undefined => {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const need = (length: number) => (buffer.length >= length ? length : undefined);
  switch (buffer[0]) {
    case 0: // SetPixelFormat
      return 20;
    case 2: // SetEncodings
      return buffer.length < 4 ? undefined : 4 + 4 * view.getUint16(2);
    case 3: // FramebufferUpdateRequest
      return 10;
    case KEY_EVENT:
      return 8;
    case POINTER_EVENT:
      return 6;
    case CLIENT_CUT_TEXT:
      // A negative length is the extended clipboard's.
      return need(8) && 8 + Math.abs(view.getInt32(4));
    case 150: // EnableContinuousUpdates
      return 10;
    case 248: // ClientFence
      return need(9) && 9 + view.getUint8(8);
    case 250: // xvp
      return 4;
    case 251: // SetDesktopSize
      return need(8) && 8 + 16 * view.getUint8(6);
    case 253: // gii
      return need(4) && 4 + view.getUint16(2);
    case QEMU_MESSAGE:
      return need(2) && (buffer[1] === QEMU_EXTENDED_KEY ? 12 : "unknown");
    default:
      return "unknown";
  }
};

/** Input that only the viewer in control may send. */
const isInput = (message: Uint8Array) => {
  switch (message[0]) {
    case KEY_EVENT:
    case POINTER_EVENT:
    case CLIENT_CUT_TEXT:
    case 250: // xvp: power actions
    case 251: // SetDesktopSize
    case 253:
    case QEMU_MESSAGE:
      return true;
    default:
      return false;
  }
};

export const makeRfbInputFilter = (input: {
  readonly forward: (bytes: Uint8Array) => void;
  readonly mayControl: () => boolean;
  readonly fail: () => void;
}): RfbInputFilter => {
  let phase: Phase = "version";
  let buffer = new Uint8Array(0);
  let failed = false;
  const heldKeys = new Set<number>();
  let pointer = { x: 0, y: 0, buttons: 0 };

  const fail = () => {
    failed = true;
    input.fail();
  };

  const track = (message: Uint8Array) => {
    const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
    if (message[0] === KEY_EVENT) {
      const keysym = view.getUint32(4);
      if (message[1] === 0) heldKeys.delete(keysym);
      else heldKeys.add(keysym);
    } else if (message[0] === POINTER_EVENT) {
      pointer = { buttons: message[1]!, x: view.getUint16(2), y: view.getUint16(4) };
    } else if (message[0] === QEMU_MESSAGE) {
      const keysym = view.getUint32(4);
      if (view.getUint16(2) === 0) heldKeys.delete(keysym);
      else heldKeys.add(keysym);
    }
  };

  const take = (length: number) => {
    const head = buffer.slice(0, length);
    buffer = buffer.slice(length);
    return head;
  };

  const drain = () => {
    while (!failed) {
      if (phase === "version") {
        if (buffer.length < VERSION.length) return;
        const version = take(VERSION.length);
        if (new TextDecoder("latin1").decode(version) !== VERSION) return fail();
        input.forward(version);
        phase = "security";
        continue;
      }
      if (phase === "security" || phase === "clientInit") {
        if (buffer.length < 1) return;
        const byte = take(1);
        if (phase === "security" && byte[0] !== SECURITY_NONE) return fail();
        input.forward(byte);
        phase = phase === "security" ? "clientInit" : "messages";
        continue;
      }
      if (buffer.length < 1) return;
      const length = messageLength(buffer);
      if (length === "unknown") return fail();
      if (length === undefined || buffer.length < length) return;
      const message = take(length);
      if (isInput(message)) {
        if (!input.mayControl()) continue;
        track(message);
      }
      input.forward(message);
    }
  };

  return {
    receive: (data) => {
      if (failed) return;
      const next = new Uint8Array(buffer.length + data.length);
      next.set(buffer);
      next.set(data, buffer.length);
      buffer = next;
      drain();
    },
    releaseHeldInput: () => {
      if (failed || phase !== "messages") return;
      for (const keysym of heldKeys) {
        const up = new Uint8Array(8);
        up[0] = KEY_EVENT;
        new DataView(up.buffer).setUint32(4, keysym);
        input.forward(up);
      }
      heldKeys.clear();
      if (pointer.buttons !== 0) {
        const release = new Uint8Array(6);
        const view = new DataView(release.buffer);
        release[0] = POINTER_EVENT;
        view.setUint16(2, pointer.x);
        view.setUint16(4, pointer.y);
        input.forward(release);
        pointer = { ...pointer, buttons: 0 };
      }
    },
  };
};
