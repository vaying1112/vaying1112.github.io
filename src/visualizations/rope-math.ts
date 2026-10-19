export function phaseState(beta: number, target: number) {
  const deltas = Array.from({ length: 9 }, (_, i) => i - 8);
  const scores = deltas.map(delta => Math.cos(delta * 0.4 + beta));
  const weights = scores.map(score => Math.exp(score - Math.max(...scores)));
  const sum = weights.reduce((a, b) => a + b, 0);
  const probabilities = weights.map(value => value / sum);
  const loss = -Math.log(probabilities[target + 8]);
  const gradient = deltas.reduce((sum, delta, i) => sum + (probabilities[i] - Number(delta === target)) * -Math.sin(delta * 0.4 + beta), 0);
  return { deltas, probabilities, loss, gradient };
}
export function responsePath(content = 0) {
  return Array.from({ length: 161 }, (_, i) => {
    const delta = i / 8;
    return `${i ? 'L' : 'M'}${36 + delta * 21},${120 - (Math.cos(delta * 0.4) + content) * 42}`;
  }).join(' ');
}
