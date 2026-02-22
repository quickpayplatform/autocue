export type Point = { x: number; y: number };

function gaussianElimination(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  for (let i = 0; i < n; i += 1) {
    let maxRow = i;
    for (let k = i + 1; k < n; k += 1) {
      if (Math.abs(matrix[k][i]) > Math.abs(matrix[maxRow][i])) {
        maxRow = k;
      }
    }
    [matrix[i], matrix[maxRow]] = [matrix[maxRow], matrix[i]];
    [vector[i], vector[maxRow]] = [vector[maxRow], vector[i]];

    const pivot = matrix[i][i];
    for (let j = i; j < n; j += 1) {
      matrix[i][j] /= pivot;
    }
    vector[i] /= pivot;

    for (let k = 0; k < n; k += 1) {
      if (k === i) continue;
      const factor = matrix[k][i];
      for (let j = i; j < n; j += 1) {
        matrix[k][j] -= factor * matrix[i][j];
      }
      vector[k] -= factor * vector[i];
    }
  }

  return vector;
}

export function computeHomography(src: Point[], dst: Point[]) {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error("Need 4 points to compute homography");
  }

  const matrix: number[][] = [];
  const vector: number[] = [];

  for (let i = 0; i < 4; i += 1) {
    const { x: xs, y: ys } = src[i];
    const { x: xd, y: yd } = dst[i];

    matrix.push([xs, ys, 1, 0, 0, 0, -xs * xd, -ys * xd]);
    vector.push(xd);
    matrix.push([0, 0, 0, xs, ys, 1, -xs * yd, -ys * yd]);
    vector.push(yd);
  }

  const solution = gaussianElimination(matrix, vector);
  return [
    [solution[0], solution[1], solution[2]],
    [solution[3], solution[4], solution[5]],
    [solution[6], solution[7], 1]
  ];
}

export function applyHomography(matrix: number[][], point: Point) {
  const x = point.x;
  const y = point.y;
  const denom = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  return {
    x: (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denom,
    y: (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denom
  };
}

export function invertHomography(matrix: number[][]) {
  const a = matrix[0][0];
  const b = matrix[0][1];
  const c = matrix[0][2];
  const d = matrix[1][0];
  const e = matrix[1][1];
  const f = matrix[1][2];
  const g = matrix[2][0];
  const h = matrix[2][1];
  const i = matrix[2][2];

  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;

  const det = a * A + b * D + c * G;
  if (det === 0) {
    throw new Error("Matrix is not invertible");
  }

  return [
    [A / det, B / det, C / det],
    [D / det, E / det, F / det],
    [G / det, H / det, I / det]
  ];
}
