const { openDatabase } = require('./db');
const { createApp } = require('./app');

const db = openDatabase();
const port = Number(process.env.PORT || 3001);
const server = createApp(db).listen(port, '0.0.0.0', () => console.log(`Event registration server listening on ${port}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
