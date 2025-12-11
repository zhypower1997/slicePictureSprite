
export interface FrameConfig {
  id: number;
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  active: boolean;
  sequenceOrder: number; // For custom sorting of animation frames
}

export interface GridDimensions {
  rows: number;
  cols: number;
}

export enum AppMode {
  GENERATE = 'GENERATE',
  EDIT = 'EDIT',
}

export interface GenerationConfig {
  prompt: string;
  ratio: string;
}
