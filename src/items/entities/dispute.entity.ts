import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entity/user.entity';
import { Item } from './item.entity';

@Entity()
export class Dispute {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reporterId' })
  reporter: User;

  @Column()
  reporterId: number;

  @ManyToOne(() => Item, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itemId' })
  item: Item;

  @Column({ nullable: true })
  itemId: number;

  @Column()
  reason: string;

  @Column({ default: 'pending' }) // pending, resolved
  status: string;

  @Column({ nullable: true })
  adminResponse: string;

  @CreateDateColumn()
  createdAt: Date;
}
