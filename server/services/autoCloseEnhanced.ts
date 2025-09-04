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
      console.log(`🕐 [${nowUTC.toISOString()}] Running enhanced auto-close check...`);

      // Close games whose UTC endTime has passed and are still active/open
      const result = await Game.updateMany(
        {
          endTimeUTC: { $lte: nowUTC },
          $and: [
            { $or: [{ currentStatus: { $ne: 'closed' } }, { currentStatus: { $exists: false } }] },
            { $or: [{ currentStatus: { $ne: 'result_declared' } }, { currentStatus: { $exists: false } }] }
          ],
          isActive: true
        },
        {
          $set: {
            currentStatus: 'closed',
            acceptingBets: false,
            autoClosedAt: nowUTC,
            lastStatusChange: nowUTC
          }
        }
      );

      if ((result as any).modifiedCount > 0) {
        console.log(`🔒 Auto-closed ${(result as any).modifiedCount} games based on UTC endTime`);

        // Log which games were closed in this sweep
        const closedGames = await Game.find({
          autoClosedAt: nowUTC
        }).select('name endTimeUTC currentStatus');

        closedGames.forEach((game) => {
          console.log(`  ├─ ${game.name} (endTime: ${game.endTimeUTC?.toISOString()}) → ${game.currentStatus}`);
        });
      } else {
        // Count active games for monitoring
        const activeGames = await Game.countDocuments({
          isActive: true,
          currentStatus: { $in: ['waiting', 'open'] }
        });
        console.log(`⏳ No games needed closing (checked ${activeGames} active games)`);
      }
    } catch (error) {
      console.error('❌ Error in enhanced auto-close sweep:', error);
    }
  }

  // Helper: update UTC fields once from IST strings
  public async updateGameUTCTimes(): Promise<void> {
    try {
      console.log('🔄 Updating game UTC times from IST...');

      const games = await Game.find({ isActive: true });

      for (const game of games) {
        if (!game.endTimeUTC && game.endTime) {
          const today = new Date();

          // Convert IST strings to UTC dates
          const startTimeUTC = game.startTime ? this.convertISTtoUTC(today, game.startTime) : undefined;
          const endTimeUTC = this.convertISTtoUTC(today, game.endTime);
          const resultTimeUTC = game.resultTime ? this.convertISTtoUTC(today, game.resultTime) : undefined;

          await Game.findByIdAndUpdate(game._id, {
            startTimeUTC,
            endTimeUTC,
            resultTimeUTC
          });

          console.log(`  ├─ Updated ${game.name}: ${game.endTime} IST → ${endTimeUTC.toISOString()} UTC`);
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

  public getStatus(): { isRunning: boolean; nextRunTime?: string } {
    return {
      isRunning: this.isRunning,
      nextRunTime: this.cronJob ? 'Every 30 seconds' : undefined
    };
  }
}

export default AutoCloseEnhancedService;
