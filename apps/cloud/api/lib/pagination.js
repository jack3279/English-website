function finiteInt(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function positiveIntParam(value, fallback, max) {
  return Math.min(max, Math.max(1, finiteInt(value, fallback)));
}

function nonNegativeIntParam(value, fallback, max) {
  return Math.min(max, Math.max(0, finiteInt(value, fallback)));
}

module.exports = { positiveIntParam, nonNegativeIntParam };
