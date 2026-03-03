import { LLMProvider, ChatMessage } from '@repo/ai';
import { modelManager } from './ModelManager';

export class MobileLlamaProvider implements LLMProvider {

  async unloadModel(): Promise<void> {
    await modelManager.unload();
  }

  async loadModel(modelPath: string): Promise<void> {
    await modelManager.load(modelPath);
  }

  private formatPrompt(messages: ChatMessage[]): string {
    const system = messages.filter(m => m.role === 'system');
    const rest = messages.filter(m => m.role !== 'system');
    const ordered = [...system, ...rest];
    return ordered.map(m => {
        const role = m.role === 'user' ? 'User' : (m.role === 'system' ? 'System' : 'Assistant');
        return `${role}: ${m.content}`;
    }).join('\\n') + '\\nAssistant:';
  }

  async generateResponse(messages: ChatMessage[], options?: any): Promise<string> {
    const prompt = this.formatPrompt(messages);
    return await modelManager.chat(prompt);
  }

  async streamResponse(messages: ChatMessage[], options?: any, onToken?: (token: string) => void): Promise<void> {
    const response = await this.generateResponse(messages, options);
    if (!onToken) return;
    const delay = typeof options?.streamDelayMs === 'number' ? options.streamDelayMs : 10;
    const chunks = response.split(/(\\s+)/).filter(part => part.length > 0);
    for (const chunk of chunks) {
        if (options?.shouldStop?.()) return;
        onToken(chunk);
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
  }
}
