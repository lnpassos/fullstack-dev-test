import { normalizeForKey } from '../../../domain/textNormalization.js';

/**
 * The single source of truth for occasions.
 *
 * Each entry carries everything about one occasion: what the picker shows, which
 * spellings resolve to it, and what to say when the model is unavailable. Adding
 * an occasion is one entry — there is no second list to remember.
 *
 * That consolidation is the point. These lived in two files before: display
 * labels in one, aliases and curated messages in another. They had to be kept in
 * step by hand. Now the label **is** an alias — the lookup index is built from
 * it — so a value the picker offers is one the fallback resolves, by
 * construction rather than by vigilance.
 */

/** Who the card is for, in the sense that changes how you write. */
export type Register = 'professional' | 'romantic' | 'family' | 'friend' | 'default';

/** `default` is required: every occasion must answer for any relationship. */
type Messages = Partial<Record<Register, readonly string[]>> & {
  readonly default: readonly string[];
};

interface Occasion {
  readonly key: string;
  /** Shown in the picker, and sent straight back to us when chosen. */
  readonly label: string;
  /** Further spellings that resolve here. Compared after normalisation. */
  readonly aliases?: readonly string[];
  /**
   * Whether the picker offers it.
   *
   * Sympathy and Valentine's are answerable but not offered: a dropdown that
   * puts "Condolences" between "Birthday" and "Graduation" reads badly. The API
   * still accepts them as free text, which is why they stay in the catalogue.
   */
  readonly offered?: boolean;
  readonly messages: Messages;
}

const OCCASIONS: readonly Occasion[] = [
  {
    key: 'birthday',
    label: 'Birthday',
    aliases: ['bday', 'birthdays'],
    messages: {
      default: [
        'Wishing you a wonderful birthday and a year full of good things.',
        'Happy birthday! Hope today is as lovely as you are.',
        'Many happy returns. May this year bring you plenty to celebrate.',
      ],
      professional: [
        'Wishing you a very happy birthday and a great year ahead.',
        'Happy birthday! Hope you get to enjoy the day properly.',
        'Best wishes on your birthday, and for the year to come.',
      ],
      romantic: [
        'Happy birthday to my favourite person. Here is to another year together.',
        'Wishing you the happiest of birthdays. You make every day better.',
        'Happy birthday, my love. Today is all about you.',
      ],
      friend: [
        'Happy birthday! Thanks for being the kind of friend everyone should have.',
        'Another year, and you only get better. Have a brilliant birthday.',
        'Hope your birthday is every bit as great as you are.',
      ],
    },
  },
  {
    key: 'wedding',
    label: 'Wedding',
    aliases: ['marriage', 'weddings'],
    messages: {
      default: [
        'Wishing you both a lifetime of happiness together.',
        'Congratulations on your wedding. May it be the start of something wonderful.',
        'So happy for you both. Here is to a beautiful life together.',
      ],
      professional: [
        'Congratulations on your wedding. Wishing you both every happiness.',
        'Warmest wishes to you both on your special day.',
        'Congratulations. May your marriage be a long and happy one.',
      ],
    },
  },
  {
    key: 'anniversary',
    label: 'Anniversary',
    aliases: ['anniversaries'],
    messages: {
      default: [
        'Happy anniversary. Here is to everything you have built together.',
        'Congratulations on another year together. May there be many more.',
        'Wishing you both a very happy anniversary.',
      ],
      romantic: [
        'Happy anniversary. I would choose you all over again.',
        'Every year with you is my favourite one yet. Happy anniversary.',
        'Here is to us, and to every year still ahead.',
      ],
    },
  },
  {
    key: 'thank you',
    label: 'Thank you',
    aliases: ['thanks', 'gratitude'],
    messages: {
      default: [
        'Thank you so much. Your kindness really made a difference.',
        'Just a small thank you for something that meant a lot.',
        'Grateful for your help. Thank you.',
      ],
      professional: [
        'Thank you for your support. It is genuinely appreciated.',
        'With sincere thanks for everything you have done.',
        'Grateful for your help on this. Thank you.',
      ],
    },
  },
  {
    key: 'congratulations',
    label: 'Congratulations',
    aliases: ['congrats', 'promotion', 'new job'],
    messages: {
      default: [
        'Congratulations! This is so well deserved.',
        'So proud of you. Enjoy every bit of this.',
        'Congratulations on the great news. Here is to what comes next.',
      ],
      professional: [
        'Congratulations on this achievement. Very well deserved.',
        'Wishing you every success in this next step.',
        'Congratulations. A pleasure to see your work recognised.',
      ],
    },
  },
  {
    key: 'graduation',
    label: 'Graduation',
    messages: {
      default: [
        'Congratulations, graduate! All that work paid off.',
        'So proud of everything you have achieved. Enjoy this one.',
        'Congratulations on your graduation. Exciting things ahead.',
      ],
    },
  },
  {
    key: 'holidays',
    label: 'Holidays',
    aliases: ['christmas', 'xmas', 'holiday', 'new year'],
    messages: {
      default: [
        'Wishing you a warm and happy holiday season.',
        'Season greetings, and all the best for the new year.',
        'Hope your holidays are restful and full of good company.',
      ],
      professional: [
        'Wishing you a happy holiday season and a great year ahead.',
        'Warm wishes for the holidays and the new year.',
        'With best wishes for a restful holiday season.',
      ],
    },
  },
  {
    key: 'baby',
    label: 'New baby',
    aliases: ['newborn', 'baby shower'],
    messages: {
      default: [
        'Congratulations on your new arrival. Wishing you all every happiness.',
        'What wonderful news. Enjoy every moment of this new chapter.',
        'Welcome to the world, little one. Congratulations to you both.',
      ],
    },
  },
  {
    key: 'get well',
    label: 'Get well',
    aliases: ['get well soon', 'recovery'],
    messages: {
      default: [
        'Wishing you a swift and gentle recovery.',
        'Thinking of you and hoping you feel better very soon.',
        'Take all the time you need. Get well soon.',
      ],
    },
  },
  {
    key: 'retirement',
    label: 'Retirement',
    messages: {
      default: [
        'Congratulations on your retirement. Enjoy every well-earned moment.',
        'Wishing you a happy retirement and time for everything you love.',
        'Here is to the next chapter. Congratulations.',
      ],
    },
  },
  {
    key: 'housewarming',
    label: 'Housewarming',
    aliases: ['new home'],
    messages: {
      default: [
        'Congratulations on the new home. Wishing you many happy years in it.',
        'Here is to a home full of good moments. Congratulations.',
        'Wishing you every happiness in your new place.',
      ],
    },
  },
  {
    key: 'farewell',
    label: 'Farewell',
    aliases: ['goodbye'],
    messages: {
      default: [
        'Wishing you all the best in what comes next.',
        'Good luck with the new chapter. You will be missed.',
        'Thank you for everything, and best of luck ahead.',
      ],
    },
  },
  {
    key: 'sympathy',
    label: 'Sympathy',
    aliases: ['condolences', 'funeral'],
    offered: false,
    messages: {
      default: [
        'Thinking of you, with deepest sympathy.',
        'So very sorry for your loss. Holding you in my thoughts.',
        'With heartfelt condolences at this difficult time.',
      ],
    },
  },
  {
    key: 'valentine',
    label: "Valentine's Day",
    aliases: ['valentines'],
    offered: false,
    messages: {
      default: [
        'Thinking of you today and always.',
        'Wishing you a day full of the people you love.',
        'Sending you love today.',
      ],
      romantic: [
        'Still you, always you.',
        'Lucky to have you, today and every day.',
        'Every day with you feels like a good one.',
      ],
    },
  },
];

/** Last resort: appropriate for any occasion and any relationship. */
const UNIVERSAL: readonly string[] = [
  'Thinking of you and wishing you all the very best.',
  'Hope this brings a smile to your day.',
  'Sending you warm wishes and good thoughts.',
  'Wishing you every happiness.',
];

/**
 * Lookup index, built once from the keys, the labels and the aliases.
 *
 * Because the labels feed it, whatever the picker offered comes back resolvable
 * without anyone having had to add a matching alias by hand.
 */
const INDEX: ReadonlyMap<string, Occasion> = new Map(
  OCCASIONS.flatMap((occasion) =>
    [occasion.key, occasion.label, ...(occasion.aliases ?? [])].map(
      (spelling) => [normalizeForKey(spelling), occasion] as const,
    ),
  ),
);

export function findOccasion(spelling: string): Occasion | undefined {
  return INDEX.get(normalizeForKey(spelling));
}

/** Labels for the picker, excluding the ones we answer but do not offer. */
export function offeredOccasionLabels(): readonly string[] {
  return OCCASIONS.filter((occasion) => occasion.offered !== false).map(
    (occasion) => occasion.label,
  );
}

export function messagesFor(occasion: Occasion, register: Register): readonly string[] {
  return occasion.messages[register] ?? occasion.messages.default;
}

export function universalMessages(): readonly string[] {
  return UNIVERSAL;
}
