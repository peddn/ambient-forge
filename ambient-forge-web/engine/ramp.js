// Weiche Wertänderung für AudioParams.
//
// Die Engine rechnet den aktuellen Wert selbst aus, weil AudioParam.value
// während einer Automation nicht in jedem Browser den laufenden Wert liefert.
// Dieser Ordner läuft ohne Build: nur Syntax bis ES2019 verwenden.

export function createRamp(context, param, initial) {
  let from = initial;
  let to = initial;
  let startTime = 0;
  let endTime = 0;

  param.value = initial;

  function current() {
    const now = context.currentTime;
    if (now >= endTime) return to;
    if (now <= startTime) return from;
    return from + ((to - from) * (now - startTime)) / (endTime - startTime);
  }

  return {
    current,
    target() {
      return to;
    },
    to(value, ms) {
      const now = context.currentTime;
      const start = current();
      param.cancelScheduledValues(now);
      param.setValueAtTime(start, now);
      from = start;
      to = value;
      startTime = now;
      endTime = now + Math.max(ms, 0) / 1000;
      if (ms > 0) {
        param.linearRampToValueAtTime(value, endTime);
      } else {
        param.setValueAtTime(value, now);
      }
    },
  };
}
