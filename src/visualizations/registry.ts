export interface RotationOptions {
  m?: number;
  n?: number;
  omega?: number;
  maxPosition?: number;
}

export interface FrequencyOptions {
  m?: number;
  base?: number;
  dimensions?: number;
  maxPosition?: number;
  mode?: 'multi' | 'same';
}

export interface VisualizationOptions {
  'rope-rotation': RotationOptions;
  'rope-frequencies': FrequencyOptions;
  'rope-training': { beta?: number; target?: number };
  'rope-partial': { delta?: number; content?: number };
  'rope-mrope': { key?: [number, number, number] };
  'rope-pairing': Record<string, never>;
}

// IDs are permanent: articles and standalone experiment URLs refer to them.
// Each ID has a matching components/visualizations/<id>.astro file.
export const visualizations = {
  'rope-rotation': {
    title: '相对位置与旋转',
    description: '调整查询位置、键位置与频率，观察相位差和点积。',
    topic: 'RoPE',
  },
  'rope-frequencies': {
    title: '多通道与频率',
    description: '对比多频率和同频率，区分 token 位置、通道组与相位。',
    topic: 'RoPE',
  },
  'rope-training': { title: '内容相位如何被训练', description: '固定频率，观察梯度如何改变内容相位与目标位置的注意力。', topic: 'RoPE' },
  'rope-partial': { title: '部分旋转的分数分解', description: '把总分拆成随位置变化的旋转项与非旋转内容项。', topic: 'RoPE' },
  'rope-mrope': { title: 'M-RoPE 时空坐标', description: '在两个视频帧的网格中选择位置，查看三个轴各自的贡献。', topic: 'M-RoPE' },
  'rope-pairing': { title: '通道布局与配对', description: '在相邻配对和前后半区配对之间重排，观察二维组如何对应。', topic: 'RoPE' },
} satisfies Record<keyof VisualizationOptions, { title: string; description: string; topic: string }>;

export type VisualizationId = keyof typeof visualizations;
export const visualizationIds = Object.keys(visualizations) as [VisualizationId, ...VisualizationId[]];

export function checkNumber(name: string, value: number, min: number, max: number, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`);
  }
  return value;
}
