"""RoPE teaching examples. Requires Python 3.9+ and NumPy.
Run: python3 rope_numpy.py
All rotations pair adjacent coordinates; model checkpoints may use another layout.
"""
import numpy as np

# region matrix
def rotate2(x, angle):
    c, s = np.cos(angle), np.sin(angle)
    R = np.array([[c, -s], [s, c]])
    return R @ np.asarray(x, dtype=float)

q = k = np.array([1.0, 0.0])
m, n, omega = 2, 5, 0.4
score_matrix = rotate2(q, m * omega) @ rotate2(k, n * omega)
score_relative = q @ rotate2(k, (n - m) * omega)
assert np.allclose(score_matrix, score_relative)
print(f"matrix: {score_matrix:.4f}")  # 0.3624
# endregion matrix

# region complex
zq, zk = 1 + 0j, 1 + 0j
m, n, omega = 2, 5, 0.4
q_rot = zq * np.exp(1j * m * omega)
k_rot = zk * np.exp(1j * n * omega)
score_complex = (q_rot * np.conj(k_rot)).real
score_phase = (zq * np.conj(zk) * np.exp(1j * (m - n) * omega)).real
assert np.allclose(score_complex, score_phase)
print(f"complex: {score_complex:.4f}")  # 0.3624
# endregion complex

# region frequencies
def apply_rope(x, position, d_rot=None, base=10000.0):
    """x: [..., d_h]; position broadcasts to x.shape[:-1]."""
    x = np.asarray(x, dtype=float)
    d = x.shape[-1] if d_rot is None else d_rot
    if not (0 < d <= x.shape[-1] and d % 2 == 0):
        raise ValueError("d_rot must be positive, even, and <= d_h")
    omega = base ** (-2 * np.arange(d // 2) / d)
    phase = np.asarray(position)[..., None] * omega
    pairs = x[..., :d].reshape(*x.shape[:-1], d // 2, 2)
    a, b = pairs[..., 0], pairs[..., 1]
    c, s = np.cos(phase), np.sin(phase)
    rotated = np.stack((a * c - b * s, a * s + b * c), axis=-1)
    return np.concatenate((rotated.reshape(*x.shape[:-1], d), x[..., d:]), axis=-1)

d_rot, base, position = 8, 10000.0, 8
omega = base ** (-2 * np.arange(d_rot // 2) / d_rot)
print("omega:", omega)              # [1.    0.1   0.01  0.001]
print("phase:", position * omega)   # [8.    0.8   0.08  0.008]
# endregion frequencies

# region training
def phase_step(beta=0.4, target=-3, lr=0.5):
    delta = np.arange(-8, 1)                 # nine visible key offsets
    omega = 0.4                             # fixed RoPE frequency
    score = np.cos(delta * omega + beta)    # learn content phase beta
    prob = np.exp(score - score.max())
    prob /= prob.sum()
    expected = (delta == target).astype(float)
    loss = -np.log(prob[delta == target][0])
    gradient = np.sum((prob - expected) * -np.sin(delta * omega + beta))
    return loss, gradient, beta - lr * gradient

loss, gradient, beta_next = phase_step()
loss_next, _, _ = phase_step(beta_next)
print(f"loss: {loss:.4f} -> {loss_next:.4f}")
print(f"gradient: {gradient:.4f}, beta_next: {beta_next:.4f}")
# endregion training

# region partial
q = np.array([1.0, 0.0, 1.0, 0.0])
k = np.array([1.0, 0.0, 0.6, 0.0])
m, n, omega = 2, 5, 0.4
# Reuse rotate2; rotate the first pair and append the unchanged tail.
q_rot = np.concatenate((rotate2(q[:2], m * omega), q[2:]))
k_rot = np.concatenate((rotate2(k[:2], n * omega), k[2:]))
rotating = q_rot[:2] @ k_rot[:2]
content = q_rot[2:] @ k_rot[2:]
assert np.allclose(q_rot @ k_rot, rotating + content)
print(f"partial: {rotating:.4f} + {content:.4f} = {q_rot @ k_rot:.4f}")
# endregion partial

# region mrope
def mrope(x, coordinate, omega, axes):
    """coordinate=(t,h,w); axes[r] selects an axis for pair r."""
    x = np.asarray(x, dtype=float).reshape(-1, 2)
    phase = np.asarray(coordinate)[axes] * np.asarray(omega)
    a, b = x[:, 0], x[:, 1]
    c, s = np.cos(phase), np.sin(phase)
    return np.stack((a * c - b * s, a * s + b * c), axis=-1).ravel()

q = k = np.array([1.0, 0.0] * 3)
axes = np.array([0, 1, 2])   # three pairs assigned to t, h, w
omega = np.array([0.4] * 3)  # same frequency here, to isolate axis selection
p_query, p_key = (0, 0, 0), (0, 1, 0)
q_rot = mrope(q, p_query, omega, axes)
k_rot = mrope(k, p_key, omega, axes)
parts = (q_rot.reshape(3, 2) * k_rot.reshape(3, 2)).sum(axis=-1)
print("axis contributions:", np.round(parts, 4))  # [1.     0.9211 1.    ]
print(f"mrope: {q_rot @ k_rot:.4f}")              # 2.9211
# endregion mrope


def verify():
    rng = np.random.default_rng(42)
    for d_h, d_rot in [(8, 8), (7, 6), (128, 32)]:
        q, k = rng.normal(size=(2, d_h))
        a = apply_rope(q, 2, d_rot) @ apply_rope(k, 5, d_rot)
        b = apply_rope(q, 9, d_rot) @ apply_rope(k, 12, d_rot)
        assert np.allclose(a, b)
        assert np.allclose(np.linalg.norm(q), np.linalg.norm(apply_rope(q, 9, d_rot)))
        assert np.array_equal(q[d_rot:], apply_rope(q, 9, d_rot)[d_rot:])
    # Broadcasting over batch, head, sequence, feature dimensions.
    x = rng.normal(size=(2, 3, 5, 8))
    batch = apply_rope(x, np.arange(5))
    for token in range(5):
        assert np.allclose(batch[:, :, token], apply_rope(x[:, :, token], token))
    # Analytic gradient against an independent finite-difference calculation.
    eps = 1e-6
    numeric = (phase_step(0.4 + eps)[0] - phase_step(0.4 - eps)[0]) / (2 * eps)
    assert np.allclose(numeric, phase_step()[1], atol=1e-8)
    assert phase_step(phase_step()[2])[0] < phase_step()[0]
    # Complex multiplication agrees with real rotation for arbitrary contents.
    for _ in range(30):
        q, k = rng.normal(size=(2, 2))
        zq, zk = complex(*q), complex(*k)
        score = (zq * np.conj(zk) * np.exp(-1.2j)).real
        assert np.allclose(score, rotate2(q, 0.8) @ rotate2(k, 2.0))
    # Shifting all three M-RoPE coordinates leaves the score unchanged.
    q, k = rng.normal(size=(2, 6))
    p, r, shift = np.array([0, 1, 2]), np.array([2, 2, 1]), np.array([3, 5, 7])
    original = mrope(q, p, omega, axes) @ mrope(k, r, omega, axes)
    moved = mrope(q, p + shift, omega, axes) @ mrope(k, r + shift, omega, axes)
    assert np.allclose(original, moved)
    print("Checks passed: relative shift, norm, partial tail, broadcasting, gradients, complex equivalence, M-RoPE.")


if __name__ == "__main__":
    verify()
