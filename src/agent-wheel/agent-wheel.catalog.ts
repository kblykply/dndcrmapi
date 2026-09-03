import { randomInt } from 'crypto';

export type AgentWheelPrize = {
  id: string;
  nameTr: string;
  nameEn: string;
  weight: number;
};

export const AGENT_WHEEL_PRIZES: readonly AgentWheelPrize[] = [
  { id: 'gbp2000', nameTr: '2000 GBP', nameEn: '2000 GBP', weight: 1 },
  {
    id: 'extra_roll',
    nameTr: 'Ekstra Çevirme',
    nameEn: 'Extra Roll',
    weight: 2,
  },
  {
    id: 'iphone',
    nameTr: 'iPhone 17 Pro Max',
    nameEn: 'iPhone 17 Pro Max',
    weight: 3,
  },
  { id: 'macbook', nameTr: 'Mac Book', nameEn: 'Mac Book', weight: 4 },
  { id: 'gold', nameTr: 'Tam Altın', nameEn: 'Full Gold Coin', weight: 6 },
  {
    id: 'dyson',
    nameTr: 'Dyson Hediye Çeki',
    nameEn: 'Dyson Gift Card',
    weight: 8,
  },
  { id: 'ipad', nameTr: 'iPad', nameEn: 'iPad', weight: 10 },
  {
    id: 'watch',
    nameTr: 'Apple Watch',
    nameEn: 'Apple Watch',
    weight: 13,
  },
  {
    id: 'playstation',
    nameTr: 'PlayStation 5',
    nameEn: 'PlayStation 5',
    weight: 16,
  },
  { id: 'vacation', nameTr: 'Tatil', nameEn: 'Vacation', weight: 37 },
] as const;

export const AGENT_WHEEL_TOTAL_WEIGHT = AGENT_WHEEL_PRIZES.reduce(
  (sum, prize) => sum + prize.weight,
  0,
);

export function pickAgentWheelPrize(roll?: number): AgentWheelPrize {
  const selectedRoll =
    roll === undefined ? randomInt(AGENT_WHEEL_TOTAL_WEIGHT) : Math.floor(roll);

  if (selectedRoll < 0 || selectedRoll >= AGENT_WHEEL_TOTAL_WEIGHT) {
    throw new RangeError('Wheel roll is outside the prize range');
  }

  let cursor = 0;
  for (const prize of AGENT_WHEEL_PRIZES) {
    cursor += prize.weight;
    if (selectedRoll < cursor) return prize;
  }

  return AGENT_WHEEL_PRIZES[AGENT_WHEEL_PRIZES.length - 1];
}
