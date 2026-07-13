import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { Mission } from './MISSION_MODELS';

export class MissionStateStore {
  constructor(private statePath = './state/mission_state.json') {}

  load(): Mission[] {
    if (!existsSync(this.statePath)) return [];
    return JSON.parse(readFileSync(this.statePath, 'utf8')) as Mission[];
  }

  save(missions: Mission[]): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(missions, null, 2));
  }
}
