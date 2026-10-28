"use strict";
(() => {
  // src/webview/pcm-worklet.ts
  var BATCH = 1600;
  var PcmTap = class extends AudioWorkletProcessor {
    buffer = new Float32Array(BATCH);
    filled = 0;
    process(inputs) {
      const channel = inputs[0]?.[0];
      if (!channel) return true;
      let at = 0;
      while (at < channel.length) {
        const n = Math.min(BATCH - this.filled, channel.length - at);
        this.buffer.set(channel.subarray(at, at + n), this.filled);
        this.filled += n;
        at += n;
        if (this.filled === BATCH) {
          const out = this.buffer;
          this.port.postMessage(out, [out.buffer]);
          this.buffer = new Float32Array(BATCH);
          this.filled = 0;
        }
      }
      return true;
    }
  };
  registerProcessor("pcm-tap", PcmTap);
})();
