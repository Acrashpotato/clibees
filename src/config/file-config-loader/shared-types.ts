export type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { [key: string]: JsonLike };

export interface SourceLine {
  indent: number;
  lineNumber: number;
  text: string;
}
