import {
  AGENT_WHEEL_PRIZES,
  AGENT_WHEEL_TOTAL_WEIGHT,
  pickAgentWheelPrize,
} from './agent-wheel.catalog';
import { splitUnitAddress } from './agent-wheel.service';

describe('agent wheel catalog', () => {
  it('keeps the configured weights at 100 without exposing percentages to the client', () => {
    expect(AGENT_WHEEL_TOTAL_WEIGHT).toBe(100);
    expect(AGENT_WHEEL_PRIZES).toHaveLength(10);
  });

  it('resolves deterministic weighted boundaries', () => {
    expect(pickAgentWheelPrize(0).id).toBe('gbp2000');
    expect(pickAgentWheelPrize(1).id).toBe('extra_roll');
    expect(pickAgentWheelPrize(62).id).toBe('playstation');
    expect(pickAgentWheelPrize(63).id).toBe('vacation');
    expect(pickAgentWheelPrize(99).id).toBe('vacation');
  });

  it('splits compact unit labels into block and apartment', () => {
    expect(splitUnitAddress('C13')).toEqual({ block: 'C', apartment: '13' });
    expect(splitUnitAddress('A15B')).toEqual({ block: 'A', apartment: '15B' });
    expect(splitUnitAddress('Blok D - 24')).toEqual({
      block: 'D',
      apartment: '24',
    });
  });
});
