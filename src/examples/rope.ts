import source from './rope_torch.py?raw';
import numpySource from './rope_numpy.py?raw';
function region(name: string) {
  const begin = `# region ${name}\n`, end = `# endregion ${name}`;
  const start = source.indexOf(begin), stop = source.indexOf(end);
  if (start < 0 || stop <= start) throw new Error(`Missing code region: ${name}`);
  return source.slice(start + begin.length, stop).trim();
}
export const ropeCode = Object.fromEntries(['matrix', 'complex', 'frequencies', 'training', 'partial', 'mrope', 'pairing', 'attention'].map(name => [name, region(name)]));
export { source as ropeSource, numpySource };
