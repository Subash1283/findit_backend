// src/items/entity/item.entity.ts

export enum ItemType {
  LOST = 'lost',
  FOUND = 'found',
}

export enum Currency {
  NPR = 'NPR',
  USD = 'USD',
  INR = 'INR',
  EUR = 'EUR',
}

export enum ItemStatus {
  ACTIVE = 'active',
  SOLVED = 'solved',  
  CLAIMED = 'claimed',
}

export enum BlurType {
  NONE = 'none',
  FULL_IMAGE = 'full_image',
  SERIAL_NUMBER = 'serial_number',
  ID_NUMBER = 'id_number',
  CARD_NUMBER = 'card_number',
  FACE = 'face',
  CUSTOM = 'custom',
}
