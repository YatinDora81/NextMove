/**
 * tests/e2e/helpers/profile.ts — the vault contents every e2e run starts from.
 *
 * SEC 7.2 shape, entirely invented: no real person, no reachable address, no real phone number,
 * no real profile URLs. It exists so the specs can assert exact strings in exact inputs — the
 * assertion happy-dom cannot make, because it never lays a form out or runs a real setter.
 *
 * The values are deliberately *distinctive* ("Kulkarni", "10119") so a spec that greps a whole
 * form for them cannot pass by accident on placeholder text.
 */

import type { Profile } from '@/shared/types';

export const E2E_PROFILE_ID = 'e2e-profile';

/** Fixed timestamp: nothing in the suite should depend on when it ran. */
const UPDATED_AT = Date.UTC(2026, 0, 14, 9, 0, 0);

export const E2E_PROFILE: Profile = {
  id: E2E_PROFILE_ID,
  label: 'E2E fixture profile',
  isDefault: true,
  summary:
    'Backend engineer with four years on payment infrastructure, most of it spent on the parts ' +
    'that have to keep working at three in the morning.',
  personal: {
    firstName: 'Riya',
    lastName: 'Kulkarni',
    email: 'riya.kulkarni@example.com',
    phone: '+1 415 555 0134',
    address: {
      line1: '18 Marlow Street',
      line2: 'Apt 4',
      city: 'Berlin',
      state: 'Berlin',
      postalCode: '10119',
      country: 'Germany',
    },
  },
  links: {
    linkedin: 'https://www.linkedin.com/in/riyakulkarni',
    github: 'https://github.com/riyakulkarni',
    portfolio: 'https://riya-kulkarni.example.com',
    other: [],
  },
  work: [
    {
      title: 'Senior Backend Engineer',
      company: 'Fablewright',
      location: 'Berlin, Germany',
      start: '2023-02',
      end: null,
      current: true,
      bullets: [
        'Owned the ledger service behind an invented payments product.',
        'Cut settlement latency by moving reconciliation off the request path.',
      ],
    },
  ],
  education: [
    {
      school: 'University of Pune',
      degree: 'B.E.',
      field: 'Computer Engineering',
      start: '2015-08',
      end: '2019-05',
      gpa: '8.4/10',
    },
  ],
  skills: ['TypeScript', 'PostgreSQL', 'Kubernetes'],
  authorization: {
    authorizedIn: ['EU', 'European Union', 'Germany'],
    needsSponsorship: { US: true, EU: false },
    visaStatus: 'EU work permit',
    willingToRelocate: true,
    remotePreference: 'remote',
  },
  eeo: {
    gender: 'Female',
    ethnicity: 'Asian',
    veteran: 'I am not a protected veteran',
    disability: 'No, I do not have a disability',
    declineToState: false,
  },
  compensation: {
    expected: { amount: 120000, currency: 'EUR', period: 'year' },
    noticePeriodDays: 30,
  },
  answers: [],
  updatedAt: UPDATED_AT,
};

/**
 * INV-5 / SEC 11: an obviously fake key. It is the right *shape* for the vault's `AIza…` guard and
 * for the masking code, and it is not, and never was, a credential. Every request it would
 * authorise is intercepted before it leaves the browser (`helpers/gemini.ts`).
 *
 * Kept in two pieces on purpose. GitHub secret scanning matches `AIza` followed by 35 characters,
 * so a fixture of this shape written as one literal raises a "Google API Key" alert on every push
 * and trains everyone to click past those alerts. Joining at runtime keeps the value identical for
 * the tests while leaving no matching literal in the source. Do not merge these back together.
 */
export const FAKE_GEMINI_KEY = ['AIza', 'SyE2E0000000FAKE0000000NOT0A0REAL0KEY'].join('');
