import { numpySource } from '../../examples/rope';
export const GET = () => new Response(numpySource, {
  headers: {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': 'attachment; filename="rope_numpy.py"',
  },
});
