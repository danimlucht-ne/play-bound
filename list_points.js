require('dotenv').config();
const mongoose = require('mongoose');
const { User } = require('./models');

async function list() {
    await mongoose.connect(process.env.MONGO_URI);
    const users = await User.find({ points: { $gt: 0 } });
    console.log('--- ALL USERS WITH POINTS ---');
    console.log(users.map(u => ({ 
        id: u.userId, 
        guild: u.guildId, 
        pts: u.points 
    })));
    process.exit(0);
}
list();