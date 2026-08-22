"""Tiny linear algebra for ridge regression. No numpy required."""

from __future__ import annotations


def zeros(rows: int, cols: int) -> list[list[float]]:
    return [[0.0] * cols for _ in range(rows)]


def identity(n: int, scale: float = 1.0) -> list[list[float]]:
    out = zeros(n, n)
    for i in range(n):
        out[i][i] = scale
    return out


def add_into(a: list[list[float]], b: list[list[float]]) -> None:
    for i in range(len(a)):
        row = a[i]
        other = b[i]
        for j in range(len(row)):
            row[j] += other[j]


def mat_vec(a: list[list[float]], x: list[float]) -> list[float]:
    out = []
    for row in a:
        s = 0.0
        for j, value in enumerate(row):
            s += value * x[j]
        out.append(s)
    return out


def solve(a: list[list[float]], b: list[float]) -> list[float]:
    n = len(a)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        pivot = col
        best = abs(m[col][col])
        for row in range(col + 1, n):
            value = abs(m[row][col])
            if value > best:
                best = value
                pivot = row
        if best < 1e-12:
            m[col][col] = 1e-12
            pivot = col
        if pivot != col:
            m[col], m[pivot] = m[pivot], m[col]
        div = m[col][col]
        for j in range(col, n + 1):
            m[col][j] /= div
        for row in range(n):
            if row == col:
                continue
            factor = m[row][col]
            if not factor:
                continue
            for j in range(col, n + 1):
                m[row][j] -= factor * m[col][j]
    return [m[i][n] for i in range(n)]


def ridge(xtx: list[list[float]], xty: list[float], lam: float) -> list[float]:
    n = len(xtx)
    a = [row[:] for row in xtx]
    for i in range(n):
        a[i][i] += lam
    return solve(a, xty)


def mean_std(values: list[float]) -> tuple[float, float]:
    n = len(values)
    if not n:
        return 0.0, 1.0
    mean = sum(values) / n
    var = sum((value - mean) ** 2 for value in values) / n
    std = var ** 0.5
    if std < 1e-9:
        std = 1.0
    return mean, std


def zscore_columns(rows: list[list[float]]) -> tuple[list[list[float]], list[float], list[float]]:
    if not rows:
        return [], [], []
    cols = len(rows[0])
    means = []
    stds = []
    for c in range(cols):
        values = [row[c] for row in rows]
        mean, std = mean_std(values)
        means.append(mean)
        stds.append(std)
    out = []
    for row in rows:
        out.append([(row[c] - means[c]) / stds[c] for c in range(cols)])
    return out, means, stds
