"""Independent RoPE teaching implementations, not a checkpoint loader.
Requires Python 3.10+ and PyTorch. Run: python rope_torch.py
References: Meta llama3 a0940f9 / llama/model.py, Transformers v4.45.2 / modeling_llama.py.
Adjacent-pair and split-half layouts are tested after an explicit permutation.
"""
import math
import torch
import torch.nn.functional as F

# region matrix
def rotate2(x, angle):
    angle = torch.as_tensor(angle, dtype=x.dtype, device=x.device)
    c, s = angle.cos(), angle.sin()
    R = torch.stack((torch.stack((c, -s)), torch.stack((s, c))))
    return R @ x

q = k = torch.tensor([1.0, 0.0], dtype=torch.float64)
m, n, omega = 2, 5, 0.4
score = rotate2(q, m * omega) @ rotate2(k, n * omega)
assert torch.allclose(score, q @ rotate2(k, (n - m) * omega))
print(f"matrix: {score.item():.4f}")  # 0.3624
# endregion matrix

# region complex
zq = zk = torch.tensor(1 + 0j, dtype=torch.complex128)
phase = torch.tensor([2, 5], dtype=torch.float64) * 0.4
rotor = torch.polar(torch.ones_like(phase), phase)
zq_rot, zk_rot = zq * rotor[0], zk * rotor[1]
score = (zq_rot * zk_rot.conj()).real
relative_rotor = torch.polar(torch.ones_like(phase[0]), phase[0] - phase[1])
assert torch.allclose(score, (zq * zk.conj() * relative_rotor).real)
print(f"complex: {score.item():.4f}")  # 0.3624
# endregion complex

# region frequencies
def rope_complex(x, positions, d_rot=None, base=10000.0):
    """x: [batch, heads, seq, dim]; positions: [seq]. Pair adjacent dims."""
    d = x.shape[-1] if d_rot is None else d_rot
    if not (0 < d <= x.shape[-1] and d % 2 == 0):
        raise ValueError("d_rot must be positive, even, and <= head dim")
    dtype = torch.float64 if x.dtype == torch.float64 else torch.float32
    omega = base ** (-torch.arange(0, d, 2, dtype=dtype, device=x.device) / d)
    positions = torch.as_tensor(positions, dtype=dtype, device=x.device)
    phase = positions[..., None] * omega  # [seq, d_rot/2]
    pairs = x[..., :d].to(dtype).reshape(*x.shape[:-1], d // 2, 2).contiguous()
    z = torch.view_as_complex(pairs)
    rotor = torch.polar(torch.ones_like(phase), phase)
    rotated = torch.view_as_real(z * rotor).flatten(-2).to(x.dtype)
    return torch.cat((rotated, x[..., d:]), dim=-1)

d_rot, base, position = 8, 10000.0, 8
omega = base ** (-torch.arange(0, d_rot, 2, dtype=torch.float64) / d_rot)
print("omega:", omega.tolist())              # [1, .1, .01, .001]
print("phase:", (position * omega).tolist()) # [8, .8, .08, .008]
# endregion frequencies

# region training
beta = torch.tensor(0.4, dtype=torch.float64, requires_grad=True)
delta = torch.arange(-8, 1, dtype=torch.float64)
# beta represents learned content phase; frequency 0.4 stays fixed.
logits = torch.cos(delta * 0.4 + beta)
loss = F.cross_entropy(logits[None, :], torch.tensor([-3 + 8]))
loss.backward()
gradient = beta.grad.item()
with torch.no_grad():
    beta -= 0.5 * beta.grad
loss_next = F.cross_entropy(torch.cos(delta * 0.4 + beta)[None, :], torch.tensor([5]))
print(f"loss: {loss.item():.4f} -> {loss_next.item():.4f}")
print(f"gradient: {gradient:.4f}, beta_next: {beta.item():.4f}")
# endregion training

# region partial
q = torch.tensor([1., 0., 1., 0.], dtype=torch.float64)
k = torch.tensor([1., 0., .6, 0.], dtype=torch.float64)
m, n, omega = 2, 5, .4
# rotate2 was defined in the matrix example.
q_rot = torch.cat((rotate2(q[:2], m * omega), q[2:]))
k_rot = torch.cat((rotate2(k[:2], n * omega), k[2:]))
rotating, content = q_rot[:2] @ k_rot[:2], q_rot[2:] @ k_rot[2:]
print(f"partial: {rotating:.4f} + {content:.4f} = {q_rot @ k_rot:.4f}")
# endregion partial

# region mrope
def mrope(x, coordinate, omega, axes):
    # Each pair takes the position of exactly one axis.
    phase = coordinate[axes] * omega
    z = torch.view_as_complex(x.reshape(-1, 2).contiguous())
    rotor = torch.polar(torch.ones_like(phase), phase)
    return torch.view_as_real(z * rotor).flatten()

q = k = torch.tensor([1., 0.] * 3, dtype=torch.float64)
axes = torch.tensor([0, 1, 2])  # t, h, w
omega = torch.full((3,), .4, dtype=torch.float64)  # isolate axis selection
p_query, p_key = torch.tensor([0, 0, 0]), torch.tensor([0, 1, 0])
q_rot = mrope(q, p_query, omega, axes)
k_rot = mrope(k, p_key, omega, axes)
parts = (q_rot.reshape(3, 2) * k_rot.reshape(3, 2)).sum(-1)
print("axis contributions:", "[" + ", ".join(f"{value:.4f}" for value in parts.tolist()) + "]")
print(f"mrope: {q_rot @ k_rot:.4f}")  # 2.9211
# endregion mrope

# region pairing
def rope_split_half(x, positions, base=10000.0):
    # Real coordinates stored as [a0, a1, ..., b0, b1, ...].
    d = x.shape[-1]
    omega = base ** (-torch.arange(0, d, 2, dtype=x.dtype, device=x.device) / d)
    phase = torch.as_tensor(positions, dtype=x.dtype, device=x.device)[..., None] * omega
    angle = torch.cat((phase, phase), dim=-1)
    a, b = x.chunk(2, dim=-1)
    quarter_turn = torch.cat((-b, a), dim=-1)
    return x * angle.cos() + quarter_turn * angle.sin()

def to_split_half(x):
    return torch.cat((x[..., 0::2], x[..., 1::2]), dim=-1)

x = torch.tensor([[[[1., 2., 3., 4.]]]], dtype=torch.float64)
a = to_split_half(rope_complex(x, torch.tensor([3])))
b = rope_split_half(to_split_half(x), torch.tensor([3]))
assert torch.allclose(a, b)
print("adjacent / split-half agree after permutation:", torch.allclose(a, b))
# endregion pairing

# region attention
torch.manual_seed(7)
B, H, L, D = 1, 2, 9, 4
x = torch.randn(B, L, 6, dtype=torch.float64)
W_Q = torch.nn.Linear(6, H * D, bias=False, dtype=torch.float64)
W_K = torch.nn.Linear(6, H * D, bias=False, dtype=torch.float64)
q = W_Q(x).reshape(B, L, H, D).transpose(1, 2)  # [B,H,L,D]
k = W_K(x).reshape(B, L, H, D).transpose(1, 2)
positions = torch.arange(L)
q_rot, k_rot = rope_complex(q, positions), rope_complex(k, positions)
scores = (q_rot @ k_rot.transpose(-1, -2)) / math.sqrt(D)
future = torch.ones(L, L, dtype=torch.bool).triu(1)
scores = scores.masked_fill(future, float('-inf'))
# A teaching loss: last query m=8 should attend to key n=5 (delta=-3).
loss = F.cross_entropy(scores[:, :, -1].reshape(B * H, L), torch.full((B * H,), 5))
loss.backward()
assert W_Q.weight.grad.norm() > 0 and W_K.weight.grad.norm() > 0
print("W_Q / W_K receive gradients through fixed RoPE:", True)
# endregion attention


def verify():
    torch.manual_seed(11)
    for d_h, d_rot in [(8, 8), (7, 6), (128, 32)]:
        q, k = torch.randn(2, 2, 3, 5, d_h, dtype=torch.float64)
        pos = torch.arange(5)
        qr, kr = rope_complex(q, pos, d_rot), rope_complex(k, pos, d_rot)
        qa, ka = rope_complex(q, pos + 7, d_rot), rope_complex(k, pos + 7, d_rot)
        torch.testing.assert_close(qr @ kr.transpose(-1, -2), qa @ ka.transpose(-1, -2))
        torch.testing.assert_close(q.norm(dim=-1), qr.norm(dim=-1))
        torch.testing.assert_close(q[..., d_rot:], qr[..., d_rot:])
    q = torch.randn(2, 3, 5, 8, dtype=torch.float64)
    torch.testing.assert_close(to_split_half(rope_complex(q, torch.arange(5))), rope_split_half(to_split_half(q), torch.arange(5)))
    x = torch.randn(1, 1, 3, 4, dtype=torch.float64, requires_grad=True)
    assert torch.autograd.gradcheck(lambda value: rope_complex(value, torch.arange(3)), (x,))
    def objective(b):
        return F.cross_entropy(torch.cos(torch.arange(-8, 1, dtype=torch.float64) * .4 + b)[None], torch.tensor([5]))
    eps = 1e-6
    numeric = (objective(.4 + eps) - objective(.4 - eps)) / (2 * eps)
    torch.testing.assert_close(numeric, torch.tensor(gradient, dtype=torch.float64))
    assert loss_next.item() < objective(.4).item()
    q, k = torch.randn(2, 6, dtype=torch.float64)
    p, n, shift = torch.tensor([0, 1, 2]), torch.tensor([2, 2, 1]), torch.tensor([3, 5, 7])
    original = mrope(q, p, omega, axes) @ mrope(k, n, omega, axes)
    shifted = mrope(q, p + shift, omega, axes) @ mrope(k, n + shift, omega, axes)
    torch.testing.assert_close(original, shifted)
    print("Checks passed: shifts, norm, partial tail, pairing permutation, gradcheck, phase gradient, M-RoPE.")


if __name__ == '__main__':
    verify()
