/**
 * Claude-edző: elemzés kérése az Anthropic API-tól, közvetlenül a böngészőből.
 *
 * Az API-kulcs csak ezen az eszközön van (localStorage), nem kerül az exportált
 * mentésbe. Az SDK-t csak az első elemzéskor töltjük be, hogy az app indulása gyors maradjon.
 */
import type { AppData, CoachReport } from '../domain/types';
import { uid } from '../util/format';
import { ADVICE_SCHEMA, buildCoachMessage, COACH_MODEL, estimateCostUsd, parseAdvice, SYSTEM_PROMPT } from './prompt';

const KEY_STORAGE = 'bowling-naplo-anthropic-key';

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}
export function setApiKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* privát mód: nem menthető */
  }
}
export const maskKey = (k: string) => (k.length > 16 ? `${k.slice(0, 12)}…${k.slice(-4)}` : '••••');

export class CoachError extends Error {}

export interface CoachRequest {
  apiKey: string;
  data: AppData;
  today: string;
  question?: string;
  signal?: AbortSignal;
  /** Hány karakter érkezett eddig a válaszból (haladásjelzéshez). */
  onProgress?: (chars: number) => void;
}

export async function requestCoachAdvice(req: CoachRequest): Promise<CoachReport> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // Egyszemélyes app, a felhasználó saját kulcsával: a böngészőből hívjuk az API-t.
  const client = new Anthropic({ apiKey: req.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });

  let message;
  try {
    const stream = client.beta.messages.stream(
      {
        model: COACH_MODEL,
        max_tokens: 16000,
        // Ha a modell biztonsági okból elutasítaná, a szerver automatikusan másik modellel próbálja.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: {
          effort: 'high',
          format: { type: 'json_schema', schema: ADVICE_SCHEMA },
        },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildCoachMessage(req.data, req.today, req.question) }],
      },
      { signal: req.signal },
    );
    let chars = 0;
    stream.on('text', (t) => {
      chars += t.length;
      req.onProgress?.(chars);
    });
    message = await stream.finalMessage();
  } catch (err) {
    throw toCoachError(err, Anthropic);
  }

  if (message.stop_reason === 'refusal') throw new CoachError('Az edző most nem tudott választ adni erre a kérésre. Fogalmazd át a kérdést, vagy próbáld kérdés nélkül.');
  if (message.stop_reason === 'max_tokens') throw new CoachError('A válasz túl hosszú lett, és félbemaradt. Próbáld újra, esetleg rövidebb kérdéssel.');

  const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let advice;
  try {
    advice = parseAdvice(text);
  } catch (e) {
    throw new CoachError((e as Error).message);
  }

  const sessions = req.data.sessions;
  const inputTokens = message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
  const outputTokens = message.usage.output_tokens;
  return {
    id: uid(),
    createdAt: new Date().toISOString(),
    model: message.model,
    question: req.question?.trim() || undefined,
    advice,
    lastSessionDate: sessions.map((s) => s.date).sort().at(-1) ?? req.today,
    gamesCount: sessions.reduce((a, s) => a + s.games.length, 0),
    usage: { inputTokens, outputTokens, costUsd: estimateCostUsd(inputTokens, outputTokens) },
  };
}

type SDK = typeof import('@anthropic-ai/sdk').default;

function toCoachError(err: unknown, A: SDK): CoachError {
  if (err instanceof A.APIUserAbortError) return new CoachError('Megszakítva.');
  if (err instanceof A.AuthenticationError) return new CoachError('Érvénytelen API-kulcs. Ellenőrizd a Beállításokban (console.anthropic.com → API Keys).');
  if (err instanceof A.PermissionDeniedError) return new CoachError('Ennek az API-kulcsnak nincs jogosultsága ehhez a modellhez.');
  if (err instanceof A.RateLimitError) return new CoachError('Túl sok kérés vagy elérted a keretet. Várj egy kicsit, vagy nézd meg a limitet a Console-ban.');
  if (err instanceof A.BadRequestError) return new CoachError(`Az API elutasította a kérést. Gyakori ok az elfogyott egyenleg (Console → Billing). Részletek: ${err.message}`);
  if (err instanceof A.APIConnectionError) return new CoachError('Nem érem el az Anthropic szerverét. Van internetkapcsolat?');
  if (err instanceof A.APIError) {
    if (err.status === 529 || (err.status ?? 0) >= 500) return new CoachError('Az Anthropic szervere most túlterhelt vagy hibás. Próbáld újra pár perc múlva.');
    return new CoachError(`API-hiba (${err.status ?? '?'}): ${err.message}`);
  }
  return new CoachError(err instanceof Error ? err.message : 'Ismeretlen hiba történt.');
}
