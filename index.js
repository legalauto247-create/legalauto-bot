// Wrapper для запуска бота из подпапки
import('./legalauto-node-bot/index.js').catch(err => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});
