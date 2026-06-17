// ソース上の位置（1始まり）。docs/04 §4.1
export interface Position {
  line: number;
  column: number;
}

export const pos = (line: number, column: number): Position => ({ line, column });
