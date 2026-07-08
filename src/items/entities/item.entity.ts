import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entity/user.entity';
import { ItemType, Currency, ItemStatus, BlurType } from './item.enum';

@Entity()
export class Item {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column()
  category: string;

  @Column({ nullable: true })
  documentType?: string;

  @Column({ type: 'enum', enum: ItemType })
  type: ItemType;

  @Column()
  location: string;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude: number;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  sensitive?: string;

  @Column({ default: true })
  sensitiveBlur: boolean;

  @Column({ type: 'enum', enum: BlurType, default: BlurType.FULL_IMAGE, nullable: true })
  blurType: BlurType;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  reward: number;

  @Column({ type: 'enum', enum: Currency })
  currency: Currency;

  @Column({ nullable: true })
  imageFront?: string;

  @Column({ nullable: true })
  imageBack?: string;

  @Column({ type: 'enum', enum: ItemStatus, default: ItemStatus.ACTIVE })
  status: ItemStatus;

  @Column({ type: 'simple-array', nullable: true })
  tags: string[];

  @Column()
  userId: number;

  @CreateDateColumn()
  createdAt: Date;

  // Expiration date for unsolved items (default 15 days)
  @Column({ type: 'timestamp', nullable: true })
  expirationDate?: Date;

  @Column({ default: 0 })
  failedClaimAttempts: number;

  @Column({ type: 'timestamp', nullable: true })
  claimBlockedUntil?: Date;

  @ManyToOne(() => User, (user) => user.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ nullable: true })
  claimedById?: number;

  @ManyToOne(() => User, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'claimedById' })
  claimedBy?: User;
}