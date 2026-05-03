import type { SimulationResult, TxIntent } from "../core/types.js";

export interface Simulator {
  simulate(intent: TxIntent): Promise<SimulationResult>;
}

export class NoopSimulator implements Simulator {
  async simulate(_intent: TxIntent): Promise<SimulationResult> {
    return { success: true, balanceDeltas: [] };
  }
}
