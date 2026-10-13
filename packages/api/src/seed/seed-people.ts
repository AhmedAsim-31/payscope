import type { ProviderName } from '@payscope/provider-adapters/provider-name';
import type { DemoOrgKey } from './seed-identity';

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'] as const;
export type SeedCurrency = (typeof CURRENCIES)[number];

export type Person = {
  key: string;
  org: DemoOrgKey;
  provider: ProviderName;
  name: string;
  index: number;
  currency: SeedCurrency;
  providerCustomerId: string;
};

const GROUPS: { org: DemoOrgKey; provider: ProviderName; keys: string[] }[] = [
  {
    org: 'acme',
    provider: 'stripe',
    keys: [
      'maya.patel',
      'ava.chen',
      'liam.okafor',
      'sofia.rossi',
      'noah.kim',
      'emma.larsen',
      'lucas.silva',
      'mia.tanaka',
      'ethan.walker',
      'zoe.fischer',
      'oliver.grant',
      'chloe.dubois',
      'daniel.reyes',
      'grace.nakamura',
    ],
  },
  {
    org: 'acme',
    provider: 'paddle',
    keys: ['henry.adams', 'isla.murphy', 'jack.ivanov', 'kara.singh', 'leo.novak', 'nora.haddad'],
  },
  {
    org: 'acme',
    provider: 'revenuecat',
    keys: [
      'owen.baker',
      'priya.nair',
      'quinn.davis',
      'rosa.moreno',
      'sam.ito',
      'tara.lindqvist',
      'uma.sharma',
      'victor.hale',
    ],
  },
  {
    org: 'globex',
    provider: 'stripe',
    keys: [
      'wes.carter',
      'xena.popov',
      'yusuf.demir',
      'zara.ali',
      'aaron.blake',
      'bella.cruz',
      'caleb.young',
      'dina.kovac',
    ],
  },
  {
    org: 'globex',
    provider: 'paypal',
    keys: ['elio.ferrari', 'fiona.walsh', 'gus.petrov', 'hana.sato'],
  },
];

const ID_PREFIX: Record<ProviderName, string> = {
  stripe: 'cus_demo_',
  paddle: 'ctm_demo_',
  revenuecat: 'rc_demo_',
  paypal: 'PAYERDEMO',
};

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function build(): Person[] {
  const counters: Record<DemoOrgKey, number> = { acme: 0, globex: 0 };
  return GROUPS.flatMap((group) =>
    group.keys.map((key, i) => {
      const index = counters[group.org]++;
      return {
        key,
        org: group.org,
        provider: group.provider,
        name: key.split('.').map(titleCase).join(' '),
        index: i,
        currency: CURRENCIES[index % CURRENCIES.length] ?? 'USD',
        providerCustomerId: `${ID_PREFIX[group.provider]}${key.replace('.', '_')}`,
      };
    }),
  );
}

export const PEOPLE: Person[] = build();

export function peopleOf(org: DemoOrgKey, provider: ProviderName): Person[] {
  return PEOPLE.filter((p) => p.org === org && p.provider === provider);
}

export function personByKey(key: string): Person {
  const person = PEOPLE.find((p) => p.key === key);
  if (!person) throw new Error(`unknown demo person ${key}`);
  return person;
}
