import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entity/user.entity';
import { Item } from '../../items/entities/item.entity';

@Entity()
export class Review {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  rating: number; // 1 to 5

  @Column({ type: 'text', nullable: true })
  comment: string;

  @Column()
  reviewerId: number;

  @Column({ nullable: true })
  targetUserId: number;

  @Column({ default: 'user' })
  type: string; // 'user' | 'platform'

  @Column({ nullable: true })
  itemId: number;

  @Column({ default: false })
  isHidden: boolean;

  @Column({ type: 'text', nullable: true })
  adminResponse: string;

  @Column({ nullable: true })
  image?: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reviewerId' })
  reviewer: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'targetUserId' })
  targetUser: User;

  @ManyToOne(() => Item, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'itemId' })
  item: Item;
}
