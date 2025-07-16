export type RegionInfo = {
  region: string;
  users: number;
  contracts: number;
  licenses: number;
  reconnaissance: number;
  mining: number;
};

declare const regions: RegionInfo[];
export default regions;
