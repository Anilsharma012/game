import mongoose from 'mongoose';
import connectDB from '../config/database';
import Game from '../models/Game';
import User from '../models/User';
import ResultScheduler from '../services/resultScheduler';

(async () => {
  try {
    await connectDB();

    // Ensure a test admin exists
    let admin = await User.findOne({ mobile: '9999999998' });
    if (!admin) {
      admin = await User.create({
        fullName: 'Result Test Admin',
        email: 'result-test@example.com',
        mobile: '9999999998',
        password: 'test123',
        role: 'admin',
      } as any);
    }

    const now = new Date();
    const minus2 = new Date(now.getTime() - 2 * 60 * 1000);
    const minus1 = new Date(now.getTime() - 1 * 60 * 1000);
    const plus0 = new Date(now.getTime());

    const toIST = (d: Date) => {
      const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      const hh = String(ist.getHours()).padStart(2, '0');
      const mm = String(ist.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    };

    const startTime = toIST(minus2);
    const endTime = toIST(minus1);
    const resultTime = toIST(plus0);

    // Create test game that should declare result now
    const game = await Game.create({
      name: `TEST Result-Time Game ${Date.now()}`,
      type: 'jodi',
      description: 'Auto result-time test',
      isActive: true,
      startTime,
      endTime,
      resultTime,
      timezone: 'Asia/Kolkata',
      minBet: 10,
      maxBet: 1000,
      commission: 5,
      jodiPayout: 95,
      harufPayout: 9,
      crossingPayout: 95,
      currentStatus: 'closed',
      acceptingBets: false,
      createdBy: admin._id,
    } as any);

    console.log('✅ Created game for result-time test:', game.name);
    console.log('   Start:', startTime, 'IST');
    console.log('   End  :', endTime, 'IST');
    console.log('   Result:', resultTime, 'IST');

    // Trigger result check immediately
    const scheduler = ResultScheduler.getInstance();
    await scheduler.triggerResultCheck();

    // Fetch game after check
    const updated = await Game.findById(game._id);
    console.log('📊 After scheduler check:');
    console.log('   Status:', updated?.currentStatus);
    console.log('   DeclaredResult:', updated?.declaredResult);
    console.log('   ResultDeclaredAt:', updated?.resultDeclaredAt);

    if (!updated?.declaredResult) {
      throw new Error('Result was not declared automatically at resultTime');
    }

    // Cleanup
    await Game.findByIdAndDelete(game._id);
    await User.findOneAndDelete({ _id: admin._id });

    console.log('🎉 Result-time auto declaration WORKING');
    await mongoose.connection.close();
    process.exit(0);
  } catch (e) {
    console.error('❌ Result-time test failed:', e);
    await mongoose.connection.close();
    process.exit(1);
  }
})();
