export interface AutoVerificationResult {
  attempted: boolean;
  matched: boolean;
  documentName: string | null;
  accountName: string;
  verified: boolean;
  rejected: boolean;
  attemptsCount?: number;
  maxAttempts?: number;
  reason?: string;
}

export interface BulkAutoVerificationResult {
  processed: number;
  verified: number;
  rejected: number;
  pending: number;
  results: Array<AutoVerificationResult & { userId: number; userName: string }>;
}

const NEPALI_DICTIONARY: Record<string, string> = {
  // Common Names
  'सुमित': 'sumit',
  'सुबास': 'subas',
  'सुवास': 'subas',
  'राम': 'ram',
  'हरी': 'hari',
  'हरीकृष्ण': 'harikrishna',
  'सीता': 'sita',
  'गिता': 'gita',
  'लक्ष्मण': 'laxman',
  'अमित': 'amit',
  'रोशन': 'roshan',
  'अजय': 'ajay',
  'नारायण': 'narayan',
  'कृष्ण': 'krishna',
  'विष्णु': 'vishnu',
  'बिष्णु': 'bishnu',
  'शिव': 'shiva',
  'विकास': 'bikash',
  'बिकास': 'bikash',
  'सञ्जय': 'sanjay',
  'संजय': 'sanjay',
  'राजेश': 'rajesh',
  'दिनेश': 'dinesh',
  'महेश': 'mahesh',
  'सुरेश': 'suresh',
  'रुपेश': 'rupesh',
  'राकेश': 'rakesh',
  'मनिष': 'manish',
  'मनोज': 'manoj',
  'सन्तोष': 'santosh',
  'सन्तोषी': 'santoshi',
  'अनिल': 'anil',
  'सुनील': 'sunil',
  'सुनिल': 'sunil',
  'प्रदिप': 'pradeep',
  'प्रदीप': 'pradeep',
  'प्रकाश': 'prakash',
  'दिपक': 'deepak',
  'दीपक': 'deepak',
  'दीपेन्द्र': 'dipendra',
  'दिपेन्द्र': 'dipendra',
  'राजेन्द्र': 'rajendra',
  'विरेन्द्र': 'birendra',
  'बिरेन्द्र': 'birendra',

  // Common Surnames
  'श्रेष्ठ': 'shrestha',
  'शर्मा': 'sharma',
  'अधिकारी': 'adhikari',
  'थापा': 'thapa',
  'राई': 'rai',
  'गुरुङ': 'gurung',
  'मगर': 'magar',
  'खड्का': 'khadka',
  'नेपाली': 'nepali',
  'पौडेल': 'paudel',
  'पोखरेल': 'pokharel',
  'बस्नेत': 'basnet',
  'तामाङ': 'tamang',
  'कार्की': 'karki',
  'शाह': 'shah',
  'साह': 'sah',
  'कुँवर': 'kunwar',
  'जोशी': 'joshi',
  'भण्डारी': 'bhandari',
  'गिरी': 'giri',
  'दहाल': 'dahal',
  'केसी': 'kc',
  'के०सी०': 'kc',
  'महर्जन': 'maharjan',
  'शाक्य': 'shakya',
  'बज्राचार्य': 'bajracharya',
  'प्रधान': 'pradhan',
  'तण्डुकार': 'tandukar',
  'सुबेदी': 'subedi',
  'गौतम': 'gautam',
  'लामा': 'lama',
  'खत्री': 'khatri',
  'पुन': 'pun',
  'शेर्पा': 'sherpa',
  'क्षेत्री': 'chhetri',
  'बोगटी': 'bogati',
  'चौधरी': 'chaudhary',
  'यादव': 'yadav',
  'सिंह': 'singh',
  'महतो': 'mahato',
  'झा': 'jha',
};

const DEVANAGARI_MAP: Record<string, string> = {
  'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
  '्': '', 'ं': 'n', 'ँ': 'n', 'ः': 'h',
};

export function transliterateDevanagari(text: string): string {
  if (!text) return '';
  const words = text.trim().split(/\s+/);
  const resultWords = words.map(word => {
    const cleanWord = word.replace(/[^\u0900-\u097F]/g, '');
    if (NEPALI_DICTIONARY[cleanWord]) {
      return NEPALI_DICTIONARY[cleanWord];
    }
    let res = '';
    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      if (DEVANAGARI_MAP[char] !== undefined) {
        res += DEVANAGARI_MAP[char];
      } else {
        res += char;
      }
    }
    return res;
  });

  return resultWords.join(' ');
}

export function normalizeName(name: string): string {
  if (!name) return '';
  const transliterated = transliterateDevanagari(name);
  return transliterated
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameWords(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .filter((w) => w.length > 1);
}

/** Returns true when the account full name and document name refer to the same person. */
export function namesMatch(accountName: string, documentName: string): boolean {
  const a = normalizeName(accountName);
  const b = normalizeName(documentName);
  if (!a || !b) return false;
  if (a === b) return true;

  const wordsA = nameWords(accountName);
  const wordsB = nameWords(documentName);
  if (!wordsA.length || !wordsB.length) return false;

  const allWordsPresent = (needles: string[], haystack: string[]) =>
    needles.every((w) =>
      haystack.some((h) => h === w || h.includes(w) || w.includes(h)),
    );

  return allWordsPresent(wordsA, wordsB) || allWordsPresent(wordsB, wordsA);
}
