import * as cron from 'node-cron';
import Game from '../models/Game';

class AutoCloseEnhancedService {
  private static instance: AutoCloseEnhancedService;
  private isRunning = false;
  private cronJob?: cron.ScheduledTask;

  static getInstance(): AutoCloseEnhancedService {
    if (!AutoCloseEnhancedService.instance) {
      AutoCloseEnhancedService.instance = new AutoCloseEnhancedService();
    }
    return AutoCloseEnhancedService.instance;
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('🔒 Auto-Close Enhanced Service already running');
      return;
    }

    console.log('🚀 Starting Enhanced Auto-Close Service...');

    // Run initial sweep on startup
    await this.runSweep();

    // Schedule to run every 30 seconds
    this.cronJob = cron.schedule(
      '*/30 * * * * *',
      async () => {
        await this.runSweep();
      },
      { scheduled: true } as any // keep typings simple across node-cron versions
    );

    // Daily recompute of UTC fields at 00:05 IST
    cron.schedule(
      '5 0 * * *',
      async () => {
        try {
          await this.updateGameUTCTimes(true);
        } catch (e) {
          console.error('❌ Daily UTC recompute failed:', e);
        }
      },
      { scheduled: true } as any
    );

    this.isRunning = true;
    console.log('✅ Enhanced Auto-Close Service started (runs every 30 seconds)');
  }

  public stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = undefined;
    }
    this.isRunning = false;
    console.log('🛑 Enhanced Auto-Close Service stopped');
  }

  private async runSweep(): Promise<void> {
    try {
      const nowUTC = new Date();
      console.log(`🕐 [${nowUTC.toISOString()}] Running enhanced timing sweep...`);

      const games = await Game.find({ isActive: true }).select(
        'name startTime endTime resultTime currentStatus acceptingBets declaredResult startTimeUTC endTimeUTC resultTimeUTC'
      );

      let opened = 0;
      let closed = 0;
      let resultsTriggered = 0;

      for (const game of games) {
        const status = this.computeStatus(game.startTime, game.endTime, game.resultTime);

        if (status === 'open') {
          if (game.currentStatus !== 'open' || game.acceptingBets === false) {
            await Game.findByIdAndUpdate(game._id, {
              $set: {
                currentStatus: 'open',
                acceptingBets: true,
                lastStatusChange: nowUTC
              },
              $unset: { forcedStatus: "" }
            });
            opened++;
          }
        } else if (status === 'closed') {
          if (game.currentStatus !== 'closed' || game.acceptingBets !== false) {
            await Game.findByIdAndUpdate(game._id, {
              $set: {
                currentStatus: 'closed',
                acceptingBets: false,
                autoClosedAt: nowUTC,
                lastStatusChange: nowUTC
              }
            });
            closed++;
          }
        } else if (status === 'result_time') {
          if (!game.declaredResult) {
            await Game.findByIdAndUpdate(game._id, {
              $set: {
                currentStatus: 'closed',
                acceptingBets: false,
                isResultPending: true,
                lastStatusChange: nowUTC
              }
            });
            resultsTriggered++;
          }
        }
      }

      console.log(`📈 Sweep summary → opened:${opened} closed:${closed} result_pending:${resultsTriggered}`);
    } catch (error) {
      console.error('❌ Error in enhanced timing sweep:', error);
    }
  }

  // Helper: update UTC fields from IST strings (recomputed daily or on demand)
  public async updateGameUTCTimes(force: boolean = false): Promise<void> {
    try {
      console.log('🔄 Updating game UTC times from IST...');

      const games = await Game.find({ isActive: true });
      const today = new Date();

      for (const game of games) {
        if (force || game.endTime) {
          const { startUTC, endUTC, resultUTC } = this.computeUTCTimesForCycle(today, game.startTime, game.endTime, game.resultTime);

          await Game.findByIdAndUpdate(game._id, {
            startTimeUTC: startUTC,
            endTimeUTC: endUTC,
            resultTimeUTC: resultUTC
          });

          console.log(`  ├─ ${game.name}: start ${startUTC?.toISOString()} | end ${endUTC?.toISOString()} | result ${resultUTC?.toISOString()}`);
        }
      }

      console.log('✅ Game UTC times updated');
    } catch (error) {
      console.error('❌ Error updating game UTC times:', error);
    }
  }

  private convertISTtoUTC(baseDate: Date, timeStr: string): Date {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const istDate = new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate(),
      hours,
      minutes,
      0,
      0
    );
    // IST = UTC + 5:30 → UTC = IST - 5:30
    return new Date(istDate.getTime() - 5.5 * 60 * 60 * 1000);
  }

  private computeUTCTimesForCycle(baseDate: Date, start: string, end: string, result: string) {
    const toMinutes = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const startM = toMinutes(start);
    const endM = toMinutes(end);
    const resultM = toMinutes(result);

    // Build IST dates anchored to baseDate
    let startDate = new Date(baseDate);
    startDate.setHours(Math.floor(startM / 60), startM % 60, 0, 0);

    let endDate = new Date(baseDate);
    endDate.setHours(Math.floor(endM / 60), endM % 60, 0, 0);

    let resultDate = new Date(baseDate);
    resultDate.setHours(Math.floor(resultM / 60), resultM % 60, 0, 0);

    // Handle cross-day relations
    if (endM < startM) {
      // end next day
      endDate.setDate(endDate.getDate() + 1);
    }
    // result relative to end
    if (resultM < endM) {
      resultDate.setDate(resultDate.getDate() + 1);
    }

    // Convert to UTC timestamps
    const toTimeStr = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return {
      startUTC: this.convertISTtoUTC(startDate, toTimeStr(startDate)),
      endUTC: this.convertISTtoUTC(endDate, toTimeStr(endDate)),
      resultUTC: this.convertISTtoUTC(resultDate, toTimeStr(resultDate))
    };
  }

  private computeStatus(start: string, end: string, result: string): 'waiting' | 'open' | 'closed' | 'result_time' {
    const toMinutes = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const nowUTC = new Date();
    const nowIST = new Date(nowUTC.getTime() + 5.5 * 60 * 60 * 1000);
    const currentM = nowIST.getHours() * 60 + nowIST.getMinutes();
    const startM = toMinutes(start);
    const endM = toMinutes(end);
    const resultM = toMinutes(result);

    if (endM > startM) {
      // same-day close
      if (currentM >= startM && currentM < endM) return 'open';
      if (resultM >= endM) {
        if (currentM >= endM && currentM < resultM) return 'closed';
        if (currentM >= resultM) return 'result_time';
      } else {
        // result next day
        if (currentM >= endM) return 'closed';
        if (currentM < startM && currentM >= resultM) return 'result_time';
      }
      return 'waiting';
    } else {
      // cross-day close (end next day)
      if (currentM >= startM || currentM < endM) return 'open';
      if (resultM > endM) {
        if (currentM >= endM && currentM < resultM) return 'closed';
        if (currentM >= resultM && currentM < startM) return 'result_time';
      } else {
        if ((currentM >= endM && currentM < 1440) || currentM < resultM) return 'closed';
        if (currentM >= resultM && currentM < startM) return 'result_time';
      }
      return 'waiting';
    }
  }

  public getStatus(): { isRunning: boolean; nextRunTime?: string } {
    return {
      isRunning: this.isRunning,
      nextRunTime: this.cronJob ? 'Every 30 seconds' : undefined
    };
  }
}

export default AutoCloseEnhancedService;
