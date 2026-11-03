// Rastpunkte der Zeitregler in Millisekunden: fein bei kurzen Zeiten, grob bei langen.

function steps(from, to, step) {
  const values = [];
  for (let value = from; value <= to; value += step) values.push(value);
  return values;
}

export const FADE_STOPS_MS = [
  ...steps(0, 5000, 500),
  ...steps(6000, 15000, 1000),
  ...steps(20000, 60000, 5000),
];

export const SLIDE_STOPS_MS = [
  ...steps(1000, 10000, 1000),
  ...steps(15000, 60000, 5000),
  ...steps(90000, 600000, 30000),
];

export const MASTER_STOPS_MS = [
  ...steps(0, 1000, 100),
  ...steps(1500, 3000, 500),
  ...steps(4000, 10000, 1000),
];

export function formatDuration(ms) {
  if (ms < 60000) return `${String(ms / 1000).replace(".", ",")} s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}
