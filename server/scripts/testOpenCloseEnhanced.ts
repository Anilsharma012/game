import mongoose from 'mongoose';
import connectDB from '../config/database';
import Game from '../models/Game';
import User from '../models/User';
import AutoCloseEnhancedService from '../services/autoCloseEnhanced';

(async () => {
  try {
    await connectDB();

    // admin for createdBy
    let admin = await User.findOne({ mobile: '9999999997' });
    if (!admin) {
      admin = await User.create({
        fullName: 'Enhanced Tester',
        email: 'enhanced-test@example.com',
        mobile: '9999999997',
        password: 'test123',
        role: 'admin',
      } as any);
    }

    const now = new Date();
    const toIST = (d: Date) => {
      const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      const hh = String(ist.getHours()).padStart(2, '0');
      const mm = String(ist.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    };

    const startNow = toIST(now);
    const endPlus2 = toIST(new Date(now.getTime() + 2 * 60 * 1000));
    const resultPlus3 = toIST(new Date(now.getTime() + 3 * 60 * 1000));

    const startMinus2 = toIST(new Date(now.getTime() - 2 * 60 * 1000));
    const endMinus1 = toIST(new Date(now.getTime() - 1 * 60 * 1000));
    const resultNow = toIST(now);

    // Game that should OPEN now
    const gameOpen = await Game.create({
      name: `TEST Open Now ${Date.now()}`,
      type: 'jodi',
      description: 'Open now test',
      isActive: true,
      startTime: startNow,
      endTime: endPlus2,
      resultTime: resultPlus3,
      timezone: 'Asia/Kolkata',
      minBet: 10,
      maxBet: 1000,
      commission: 5,
      jodiPayout: 95,
      harufPayout: 9,
      crossingPayout: 95,
      currentStatus: 'waiting',
      acceptingBets: false,
      createdBy: admin._id,
    } as any);

    // Game that should be CLOSED and at result time (pending)
    const gameClose = await Game.create({
      name: `TEST Close Now ${Date.now()}`,
      type: 'jodi',
      description: 'Close/result test',
      isActive: true,
      startTime: startMinus2,
      endTime: endMinus1,
      resultTime: resultNow,
      timezone: 'Asia/Kolkata',
      minBet: 10,
      maxBet: 1000,
      commission: 5,
      jodiPayout: 95,
      harufPayout: 9,
      crossingPayout: 95,
      currentStatus: 'open',
      acceptingBets: true,
      createdBy: admin._id,
    } as any);

    console.log('✅ Created games:', gameOpen.name, 'and', gameClose.name);

    const svc = AutoCloseEnhancedService.getInstance();
    await svc.updateGameUTCTimes(true);
    await svc.start(); // triggers initial sweep

    const updatedOpen = await Game.findById(gameOpen._id);
    const updatedClose = await Game.findById(gameClose._id);

    console.log('📊 Updated Open Game:', {
      status: updatedOpen?.currentStatus,
      acceptingBets: updatedOpen?.acceptingBets,
    });
    console.log('📊 Updated Close Game:', {
      status: updatedClose?.currentStatus,
      acceptingBets: updatedClose?.acceptingBets,
      isResultPending: updatedClose?.isResultPending,
    });

    if (updatedOpen?.currentStatus !== 'open' || updatedOpen?.acceptingBets !== true) {
      throw new Error('Open-now game did not transition to open');
    }
    if (updatedClose?.currentStatus !== 'closed' || updatedClose?.acceptingBets !== false) {
      throw new Error('Close-now game did not transition to closed');
    }

    // cleanup
    await Game.findByIdAndDelete(gameOpen._id);
    await Game.findByIdAndDelete(gameClose._id);
    await User.findOneAndDelete({ _id: admin._id });

    console.log('🎉 Enhanced open/close transitions WORKING');
    await mongoose.connection.close();
    process.exit(0);
  } catch (e) {
    console.error('❌ Enhanced open/close test failed:', e);
    await mongoose.connection.close();
    process.exit(1);
  }
})();
