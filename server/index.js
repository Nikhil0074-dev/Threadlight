import { createApp } from './app.js';
import { config } from './config.js';

createApp().listen(config.port, () => {
  console.log(`Threadlight running at http://localhost:${config.port}`);
  console.log(config.anthropicKey ? 'AI: Anthropic API' : 'AI: offline analyzer (set ANTHROPIC_API_KEY for better results)');
});
