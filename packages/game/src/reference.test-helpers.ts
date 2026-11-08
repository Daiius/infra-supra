// テスト用: シナリオの参照値（goal。D-142）に届いた完走か。合否は画面とゲームの判定から外した（D-131）が、
// バランスの回帰（何もしない方針で何本が参照値に届くか）は今までどおりこの判定で見る。
import { averageSatisfaction } from './month/satisfaction.ts';
import type { GameState } from './state.ts';

export const meetsReference = (
  s: Pick<GameState, 'phase' | 'cash' | 'history' | 'scenario'>,
): boolean =>
  s.phase === 'completed' &&
  s.cash >= s.scenario.goal.cash &&
  averageSatisfaction(s.history) >= s.scenario.goal.satisfaction;
