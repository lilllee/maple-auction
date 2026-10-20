export interface Listing {
  tradeSn: string; itemName: string; pricePerItem: number; quantity: number;
  starforce: number | null; potentialGrade: string | null; potentialLines: string[];
  additionalGrade: string | null; additionalLines: string[]; remainUpgradeCount: number | null;
  extras: string[];   // 그 밖의 툴팁 한 줄 정보. 없으면 []
}
