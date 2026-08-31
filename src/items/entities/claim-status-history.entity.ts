import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ClaimRequest } from './claim-request.entity';
import { User } from '../../users/entity/user.entity';

@Entity()
export class ClaimStatusHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ClaimRequest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'claimId' })
  claim: ClaimRequest;

  @Column()
  claimId: number;

  @Column()
  status: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'changedById' })
  changedBy: User;

  @Column({ nullable: true })
  changedById: number;

  @Column({ type: 'text', nullable: true })
  note: string;

  @CreateDateColumn()
  createdAt: Date;
}
