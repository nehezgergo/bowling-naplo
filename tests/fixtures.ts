import type { CoachReport } from '../src/domain/types';

export const sampleReport: CoachReport = {
  id: 'r1',
  createdAt: '2026-10-06T08:00:00.000Z',
  model: 'claude-opus-5-5',
  lastSessionDate: '2026-10-05',
  gamesCount: 5,
  advice: {
    summary: 'Jól haladsz.',
    previousAdviceReview: '',
    strengths: ['Stabil első dobás'],
    focusAreas: [{ title: '10-es bábu', why: '1/3 leütve', how: 'Keresztben, egyenesen.' }],
    drills: [{ name: '10-es spare', description: 'Bal oldalról', reps: '15 dobás' }],
    nextGoal: { metric: 'Egy bábus spare', target: '70%', why: 'Most 67%' },
    encouragement: 'Hajrá!',
  },
  usage: { inputTokens: 5000, outputTokens: 2000, costUsd: 0.06 },
};
