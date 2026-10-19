import { ropeSource } from '../../examples/rope';
export const GET = () => new Response(ropeSource, { headers: {
  'Content-Type': 'text/plain; charset=utf-8',
  'Content-Disposition': 'attachment; filename="rope_torch.py"',
} });
