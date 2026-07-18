import rawData from "./algeria_communes.json";

export interface Wilaya {
  code: number;
  name: string;
  communes: string[];
}

export const WILAYAS: Wilaya[] = rawData as Wilaya[];

export function getCommunesByWilayaName(name: string): string[] {
  return WILAYAS.find(w => w.name === name)?.communes ?? [];
}

export function getCommunesByWilayaCode(code: number): string[] {
  return WILAYAS.find(w => w.code === code)?.communes ?? [];
}
