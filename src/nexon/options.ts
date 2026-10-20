export type GradeCode = 'all' | 'none' | 'rare' | 'epic' | 'unique' | 'legendary';
export interface OptionEntry { label: string; code: string }

const entry = (label: string, code: string): OptionEntry => ({ label, code });

export const POTENTIAL_OPTIONS: readonly OptionEntry[] = [
  entry('보스 몬스터 데미지 % 증가', 'bossDamagePercent'),
  entry('몬스터 방어율 무시', 'ignoreMonsterDefense'),
  entry('데미지 %증가', 'damagePercent'),
  entry('공격력 %증가', 'physicalAttackPercent'),
  entry('마력 %증가', 'magicAttackPercent'),
  entry('올스탯 %증가', 'allStatsPercent'),
  entry('STR %증가', 'strPercent'),
  entry('DEX %증가', 'dexPercent'),
  entry('INT %증가', 'intPercent'),
  entry('LUK %증가', 'lukPercent'),
  entry('크리티컬 확률 증가', 'criticalPercent'),
  entry('상태 이상 내성 증가', 'statusResistance'),
  entry('모든 속성 내성 증가', 'elementalResistance'),
  entry('크리티컬 데미지 증가', 'criticalDamagePercent'),
  entry('스킬 재사용 대기시간 감소', 'skillCooldownReduction'),
  entry('아이템 획득 확률 증가', 'itemDropPercent'),
  entry('최대 HP %증가', 'maxHpPercent'),
  entry('최대 MP %증가', 'maxMpPercent'),
  entry('공격력 증가', 'physicalAttack'),
  entry('마력 증가', 'magicAttack'),
  entry('<쓸만한 헤이스트> 스킬', 'hasteSkill'),
  entry('<쓸만한 미스틱 도어> 스킬', 'mysticDoorSkill'),
  entry('<쓸만한 샤프 아이즈> 스킬', 'sharpEyesSkill'),
  entry('<쓸만한 하이퍼 바디> 스킬', 'hyperBodySkill'),
  entry('<쓸만한 컴뱃 오더스> 스킬', 'combatOrdersSkill'),
  entry('<쓸만한 어드밴스드 블레스> 스킬', 'advancedBlessSkill'),
  entry('<쓸만한 윈드 부스터> 스킬', 'windBoosterSkill'),
  entry('STR 증가', 'str'),
  entry('DEX 증가', 'dex'),
  entry('INT 증가', 'int'),
  entry('LUK 증가', 'luk'),
  entry('최대 HP 증가', 'maxHp'),
  entry('최대 MP 증가', 'maxMp'),
  entry('올스탯 증가', 'allStats'),
  entry('4차 이하 스킬 레벨 증가', 'skillLevelIncrease'),
  entry('공격 시 HP 회복', 'hpRecovery'),
  entry('공격 시 MP 회복', 'mpRecovery'),
  entry('HP 회복 아이템 및 스킬 효율 증가', 'hpRecoveryRate'),
  entry('메소 획득량 증가', 'mesosObtainedPercent'),
];

const PER_LEVEL_OPTIONS: readonly OptionEntry[] = [
  entry('캐릭터 9레벨 당 STR 증가', 'strPerLevel'),
  entry('캐릭터 9레벨 당 DEX 증가', 'dexPerLevel'),
  entry('캐릭터 9레벨 당 INT 증가', 'intPerLevel'),
  entry('캐릭터 9레벨 당 LUK 증가', 'lukPerLevel'),
];

// 에디셔널: 쓸만한 스킬 7개를 빼고, mpRecovery 뒤에 레벨 당 스탯 4개를 넣는다.
export const ADDITIONAL_POTENTIAL_OPTIONS: readonly OptionEntry[] = POTENTIAL_OPTIONS
  .filter((o) => !o.label.startsWith('<쓸만한'))
  .flatMap((o) => (o.code === 'mpRecovery' ? [o, ...PER_LEVEL_OPTIONS] : [o]));

export const GRADES: readonly { label: string; code: GradeCode }[] = [
  { label: '전체', code: 'all' },
  { label: '없음', code: 'none' },
  { label: '레어', code: 'rare' },
  { label: '에픽', code: 'epic' },
  { label: '유니크', code: 'unique' },
  { label: '레전드리', code: 'legendary' },
];

export const WORLDS: readonly { id: number; name: string }[] = [
  { id: 0, name: '스카니아' },
  { id: 1, name: '베라' },
  { id: 3, name: '루나' },
  { id: 4, name: '제니스' },
  { id: 5, name: '크로아' },
  { id: 10, name: '유니온' },
  { id: 16, name: '엘리시움' },
  { id: 29, name: '이노시스' },
  { id: 43, name: '레드' },
  { id: 44, name: '오로라' },
  { id: 50, name: '아케인' },
  { id: 51, name: '노바' },
  { id: 45, name: '에오스' },
  { id: 46, name: '헬리오스' },
  { id: 49, name: '챌린저스' },
  { id: 48, name: '챌린저스2' },
  { id: 52, name: '챌린저스3' },
  { id: 54, name: '챌린저스4' },
];

export function normalizeLabel(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

export function findOptionCode(label: string, table: readonly OptionEntry[]): string | null {
  const key = normalizeLabel(label);
  return table.find((o) => normalizeLabel(o.label) === key)?.code ?? null;
}

export function findGradeCode(label: string): GradeCode | null {
  const key = normalizeLabel(label);
  if (key === '레전더리') return 'legendary';
  return GRADES.find((g) => g.label === key)?.code ?? null;
}

export function findWorldId(name: string): number | null {
  const key = normalizeLabel(name);
  return WORLDS.find((w) => w.name === key)?.id ?? null;
}

export type ItemCategoryCode = 'ARMOR' | 'WEAPON';

export const ITEM_CATEGORIES: readonly { label: string; code: ItemCategoryCode }[] = [
  { label: '방어구', code: 'ARMOR' },
  { label: '무기', code: 'WEAPON' },
];

export function findItemCategoryCode(label: string): ItemCategoryCode | null {
  const key = normalizeLabel(label);
  return ITEM_CATEGORIES.find((c) => c.label === key)?.code ?? null;
}

export const GRADE_NUMBERS: Record<Exclude<GradeCode, 'all'>, number> = {
  none: 0, rare: 1, epic: 2, unique: 3, legendary: 4,
};
